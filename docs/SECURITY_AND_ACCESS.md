# Security and access

The live demonstration is protected by login and remains available free of charge throughout the judging period.

## Judge access

The Devpost submission must contain the working live URL and private test credentials in its testing instructions. Credentials must not be placed in this public repository, a public issue or the demo video.

Other evaluators may request temporary credentials from [belduriel@gmail.com](mailto:belduriel@gmail.com).

## Credential handling

- Production accounts are configured as salted PBKDF2 hashes outside Git.
- The server signs time-bounded sessions with a deployment secret.
- The browser cookie is `HttpOnly` and `SameSite=Strict`.
- Credentials can be rotated or revoked without changing the WebMCP contract.
- The public development account is opt-in, uses an operator-selected password and is rejected on public bind addresses.

## Responsible disclosure

Send security reports privately to the contact address above. Do not include active credentials, private corpus extracts or personal data in public reports.
