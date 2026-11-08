import assert from "node:assert/strict";
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const grpc = require("@grpc/grpc-js");
const loader = require("@grpc/proto-loader");
const proto = grpc.loadPackageDefinition(loader.loadSync("proto/bytes.proto"))
	.cloudflare.grpcdemo;
const dir = mkdtempSync(join(tmpdir(), "grpc-tls-"));
const cert = join(dir, "cert.pem"),
	key = join(dir, "key.pem");
execFileSync(
	"openssl",
	[
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-days",
		"1",
		"-keyout",
		key,
		"-out",
		cert,
		"-subj",
		"/CN=localhost",
		"-addext",
		"subjectAltName=DNS:localhost",
	],
	{ stdio: "ignore" },
);
const incomplete = spawnSync(process.execPath, ["container/server.js"], {
	env: {
		...process.env,
		GRPC_TLS_CERT: readFileSync(cert, "utf8"),
		GRPC_TLS_KEY: "",
	},
});
assert.notEqual(incomplete.status, 0);
assert.match(incomplete.stderr.toString(), /Set both/);
const server = spawn(process.execPath, ["container/server.js"], {
	env: {
		...process.env,
		GRPC_PORT: "50059",
		GRPC_TLS_CERT: readFileSync(cert, "utf8"),
		GRPC_TLS_KEY: readFileSync(key, "utf8"),
	},
	stdio: ["ignore", "pipe", "pipe"],
});
async function stream(client, chunks) {
	return await new Promise((resolve, reject) => {
		const replies = [];
		const call = client.Chat({ deadline: Date.now() + 15000 });
		call.on("data", (x) => {
			replies.push(x.payload);
			if (replies.length === 2 && chunks.length > 0) call.end();
		});
		call.on("error", reject);
		call.on("end", () => resolve(replies));
		chunks.forEach((payload) => call.write({ payload }));
		if (!chunks.length) call.end();
	});
}
try {
	await new Promise((resolve, reject) => {
		server.stdout.once("data", resolve);
		server.once("exit", (code) => reject(new Error("server exited " + code)));
		server.stderr.on("data", (x) => process.stderr.write(x));
	});
	const trusted = grpc.credentials.createSsl(readFileSync(cert));
	for (const chunks of [
		[],
		[Buffer.from([0, 255, 1])],
		[Buffer.alloc(1024 * 1024, 42)],
	]) {
		const client = new proto.ByteStream("localhost:50059", trusted);
		try {
			const replies = await stream(client, chunks);
			assert.equal(replies.length, chunks.length + 2);
			if (chunks.length)
				assert.deepEqual(
					replies[1].subarray(Buffer.byteLength("container echo 1: ")),
					chunks[0],
				);
		} finally {
			client.close();
		}
	}
	const clients = [
		new proto.ByteStream("localhost:50059", grpc.credentials.createSsl()),
		new proto.ByteStream("127.0.0.1:50059", trusted),
		new proto.ByteStream("localhost:50059", grpc.credentials.createInsecure()),
	];
	for (const client of clients) {
		try {
			await assert.rejects(stream(client, []));
		} finally {
			client.close();
		}
	}
	const tls = await import("node:tls");
	await new Promise((resolve, reject) => {
		const socket = tls.connect(
			{
				host: "localhost",
				port: 50059,
				ca: readFileSync(cert),
				ALPNProtocols: ["h2"],
			},
			() => {
				try {
					assert.equal(socket.alpnProtocol, "h2");
					socket.end();
					resolve();
				} catch (e) {
					reject(e);
				}
			},
		);
		socket.on("error", reject);
	});
	console.log(
		"TLS tests passed: bidirectional replies before request completion, empty stream, binary, 1 MiB, h2 ALPN, untrusted CA, wrong hostname, plaintext rejection.",
	);
} finally {
	server.kill("SIGTERM");
	await new Promise((resolve) => server.once("exit", resolve));
	rmSync(dir, { recursive: true, force: true });
}
