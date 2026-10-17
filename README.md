# Celeste Web

A browser-based Celeste launcher built with TypeScript and WebAssembly. Players import their own copy of the game; game files are not included or uploaded. This project is independent and is not affiliated with or endorsed by Maddy Makes Games.

## Development

Requirements: Node.js 24 and Python 3.

```sh
npm ci
make preview PORT=8031
```

Open `http://localhost:8031` to preview the app. To build the static site for Cloudflare Pages:

```sh
npm ci && make clean && make build-sdk
```

The output directory is `dist/`. Run checks with:

```sh
make typecheck
make test
```

## Game files and runtime

Import a ZIP of a game installation you are entitled to use. It must contain `Celeste.exe` or `Celeste.dll` and the `Content/` directory. The browser stores the imported files locally; they are not sent to the site or Supabase.

The game runtime is separate from the Pages build and must be hosted at an HTTPS `CELESTE_RUNTIME_BASE_URL`. Runtime redistribution is subject to the licenses and permissions of its components. See the [runtime distribution notes](docs/runtime-distribution.md) and [Cloudflare Pages guide](docs/cloudflare-pages.md) before hosting or publishing runtime files.

## Optional cloud saves

Cloud saves use Supabase and GitHub sign-in. Configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as build variables; never put secret or service-role keys in the browser. See the [Supabase setup guide](docs/supabase-cloud-saves.md).

## License

Project source is licensed under MIT; see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). This does not grant rights to redistribute Celeste or third-party runtime components.
