# Security Policy

## Supported Versions

| Version        | Supported          |
| -------------- | ------------------ |
| latest release | :white_check_mark: |

## Reporting a Vulnerability

Please report security vulnerabilities through [GitHub's private vulnerability reporting](https://github.com/YOOJUNGYU/pixel-office-lan/security/advisories/new).

**Do not open a public issue for security vulnerabilities.**

We will acknowledge your report within 7 days and aim to release a fix within 30 days of confirmation.

## Scope

Security issues relevant to this project include:

- Anything that lets another PC or a remote browser run or change something on this PC
- Command injection via transcript (JSONL) parsing
- Arbitrary file read/write beyond intended paths
- Cross-site scripting (XSS) in the webview
- Sensitive data exposure (e.g., paths, IPs or tokens leaving the PC while hideDetails is on)
