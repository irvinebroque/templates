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
    │ TLS over TCP
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
- A Cloudflare zone on a Pro or Business plan, or with Spectrum Enterprise enabled
- The [Cloudflare CLI (`cf`)](https://developers.cloudflare.com/cf/get-started/)
- A [Secrets Store](https://developers.cloudflare.com/secrets-store/integrations/workers/) in the same account, with permission to create secrets and deploy bindings

## Getting Started

Install dependencies:

```sh
npm install
```

Find your store ID in the [Secrets Store dashboard](https://dash.cloudflare.com/?to=/:account/secrets-store/), or sign in with `cf auth login` and run `cf secrets-store stores list`. Replace both `<SECRETS_STORE_ID>` placeholders in `wrangler.jsonc` with that ID.

### Prepare TLS credentials

Keep the private key out of the image and repository. Add `certs/` to `.gitignore`; the included `.dockerignore` already excludes it.

For a reproducible local test, create a short-lived self-signed certificate. Replace `grpc.example.com` with your public hostname. The `localhost` subject alternative name also lets you test locally:

```sh
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -keyout certs/key.pem -out certs/cert.pem \
  -subj "/CN=grpc.example.com" \
  -addext "subjectAltName=DNS:grpc.example.com,DNS:localhost"
```

For production, obtain a PEM certificate chain and private key from a CA trusted by your clients.

Seed local Secrets Store values using the same store ID as `wrangler.jsonc`:

```sh
npx wrangler secrets-store secret create <SECRETS_STORE_ID> --name GRPC_TLS_CERT --scopes workers < certs/cert.pem
npx wrangler secrets-store secret create <SECRETS_STORE_ID> --name GRPC_TLS_KEY --scopes workers < certs/key.pem
```

These commands seed the local `.wrangler/state` used by this template. Production secrets are not available locally. `cf` does not yet support creating local Secrets Store values.

Start the Worker, Durable Object, and Container:

```sh
npm run dev
```

Wrangler listens for local gRPC traffic at `localhost:8788`. In another terminal, run the included streaming client with TLS:

```sh
GRPC_TLS=1 GRPC_CA_FILE=certs/cert.pem node container/client.js localhost:8788
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
Docker must be running. The smoke test generates temporary TLS credentials, seeds an isolated local Secrets Store, and verifies the TLS path. It does not use your production secrets.

## Deploying

Use Spectrum TCP passthrough. The Container terminates TLS, including HTTP/2 ALPN (`h2`). Workers Paid and the zone plan are separate.

Upload the certificate and private key to Secrets Store before deploying. Use a CA-issued certificate and key for production. Create request files without printing the PEM values:

```sh
node --input-type=module -e 'import fs from "node:fs"; for (const [name, file] of [["GRPC_TLS_CERT", "cert"], ["GRPC_TLS_KEY", "key"]]) { fs.writeFileSync(`certs/${file}-secret.json`, JSON.stringify({name, value: fs.readFileSync(`certs/${file}.pem`, "utf8"), scopes: ["workers"]}), {mode: 0o600}); }'
cf auth login
cf secrets-store secrets create <SECRETS_STORE_ID> --body @certs/cert-secret.json
cf secrets-store secrets create <SECRETS_STORE_ID> --body @certs/key-secret.json
rm certs/cert-secret.json certs/key-secret.json
```

Use the same store ID and secret names as `wrangler.jsonc`. The secrets need the `workers` scope.

Deploy the Worker and Container:

```sh
npm run deploy
```

The Durable Object reads both Secrets Store bindings with `.get()` and passes the PEM values into `container.start({ env: ... })`. If either secret is unavailable, startup fails. Restart existing Containers after certificate rotation so they receive the new values; running Containers retain their startup environment.

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
Do not disable certificate or hostname verification. The Worker's HTTP URL is only a status response,
not the gRPC endpoint.

## Project Structure

- `src/index.ts` implements the raw TCP Worker and Durable Object handlers plus
  the plain-text HTTP status response.
- `container/server.js` implements the bidirectional gRPC service.
- `container/client.js` is a small test client.
- `proto/bytes.proto` defines the streaming service.
- `scripts/smoke-test.mjs` verifies the complete local data path.

## Learn More

- [gRPC walkthrough with `cf init`](https://developers.cloudflare.com/containers/examples/bidirectional-grpc/)
- [Secrets Store bindings](https://developers.cloudflare.com/secrets-store/integrations/workers/)
- [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- [Durable Object Container API](https://developers.cloudflare.com/durable-objects/api/container/)
- [Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Workers protocol support](https://developers.cloudflare.com/workers/reference/protocols/)
