# gRPC Container

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/templates/tree/main/grpc-container-template)

![gRPC logo](./preview.png)

<!-- dash-content-start -->

Run a bidirectional streaming gRPC service inside a Cloudflare Container and
proxy its raw bytes through a Worker and Durable Object.

This template combines:

- A Worker `connect()` handler for inbound TCP streams.
- A Durable Object `connect()` handler that owns the Container instance.
- The low-level Container TCP port API for reaching the gRPC server.

The Worker does not parse or terminate gRPC. It streams bytes in both directions,
leaving HTTP/2 and gRPC handling to the service inside the Container.

<!-- dash-content-end -->

Outside of this repository, create a new project from the template with
[C3](https://developers.cloudflare.com/pages/get-started/c3/) (`create-cloudflare`):

```sh
npm create cloudflare@latest -- --template=cloudflare/templates/grpc-container-template
```

## Architecture

```text
gRPC client
    │
    │ raw TCP
    ▼
Worker.connect()
    │
    │ GRPC_CONTAINER.getByName(...).connect()
    ▼
GrpcContainer.connect()
    │
    │ ctx.container.getTcpPort(50051).connect()
    ▼
gRPC server in the Container
```

The gRPC listener uses port `8788` during local development.

## Prerequisites

- Node.js 20.16 or newer
- Docker running locally
- Access to Cloudflare Containers for deployment
- A Cloudflare zone on a Pro or Business plan for inbound TCP access

## Getting Started

Install dependencies:

```sh
npm install
```

Start the Worker, Durable Object, and Container:

```sh
npm run dev
```

Wrangler listens for local gRPC traffic at `127.0.0.1:8788`.

In another terminal, run the included streaming client:

```sh
npm run grpc:client
```

The client receives a greeting, sends a sequence of byte payloads, receives an
echo for each payload, half-closes its request stream, and receives a final
goodbye.

## Testing

Run the Worker unit tests:

```sh
npm test
```

Run the complete local tunnel smoke test:

```sh
npm run test:e2e
npm run test:tls
```

The end-to-end test starts Wrangler, connects the included gRPC client to port
`8788`, and verifies traffic traverses the Worker, Durable Object, and Container.
Docker must be running.

## Deploying

Deploy the Worker and Container:

```sh
npm run deploy
```

Use a Pro or Business zone and configure Spectrum for TCP passthrough. TLS
terminates in the Container, including HTTP/2 ALPN (`h2`); Spectrum Enterprise
TLS termination is not required. Workers Paid and the zone plan are separate.

### Configure TLS before exposing a public endpoint

Obtain a certificate and private key for your gRPC hostname from a CA trusted
by your clients. Use the full certificate chain in PEM format. Keep the key out
of the repository and Docker image. For a reproducible test, create a short-lived
self-signed certificate and explicitly trust it in the test client:

```sh
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -keyout certs/key.pem -out certs/cert.pem \
  -subj "/CN=grpc.example.com" -addext "subjectAltName=DNS:grpc.example.com"
```

Replace `grpc.example.com` with your hostname. Create the secret upload file
without printing the key:

```sh
node --input-type=module -e 'import fs from "node:fs"; fs.writeFileSync("secrets.json", JSON.stringify({GRPC_TLS_CERT: {type: "secret_text", text: fs.readFileSync("certs/cert.pem", "utf8")}, GRPC_TLS_KEY: {type: "secret_text", text: fs.readFileSync("certs/key.pem", "utf8")}}), {mode: 0o600})'
cf workers secrets bulk --worker grpc-container-template --file secrets.json
```

Upload both secrets before creating the Spectrum application. Restart an existing
Container after rotating secrets so it receives the new certificate. Without
these secrets the server uses plaintext for local development only.

Create a Spectrum application in the same account as the Worker. Use the
Worker's immutable tag as `origin_worker_id`:

```sh
cf spectrum apps create --zone example.com --body '{"dns":{"type":"CNAME","name":"grpc.example.com"},"protocol":"tcp/50051","traffic_type":"worker","origin_worker_id":"<WORKER_TAG>"}'
```

Omit `tls` on Pro/Business. Spectrum forwards the encrypted connection unchanged;
the Worker and Durable Object also forward bytes without terminating TLS.
Wait for the Container rollout to complete before testing:

```sh
GRPC_TLS=1 GRPC_CA_FILE=certs/cert.pem node container/client.js grpc.example.com:50051
```

For a publicly trusted certificate, omit `GRPC_CA_FILE` to use system trust.
Do not disable certificate or hostname verification. The plaintext client remains
available for local development. The Worker's HTTP URL is only a status response,
not the gRPC endpoint.

## Project Structure

- `src/index.ts` implements the raw TCP Worker and Durable Object handlers plus
  the plain-text HTTP status response.
- `container/server.js` implements the bidirectional gRPC service.
- `container/client.js` is a small test client.
- `proto/bytes.proto` defines the streaming service.
- `scripts/smoke-test.mjs` verifies the complete local data path.

## Learn More

- [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- [Durable Object Container API](https://developers.cloudflare.com/durable-objects/api/container/)
- [Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Workers protocol support](https://developers.cloudflare.com/workers/reference/protocols/)
