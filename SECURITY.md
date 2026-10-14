# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the Neviweb password is a `secret` field of the Gladys
  configuration. The integration reads it from Gladys, keeps it in memory,
  sends it only to `https://neviweb.com/api/login`, and never writes it to
  `/data` nor to the logs. The e-mail never appears in the logs either.
- **Stored in `/data`** (readable by the container user only):
  `session.json`, the Neviweb session id and its cookies, with a hash of the
  e-mail to tell which account it belongs to (a stolen session gives access
  to the Neviweb account until it expires); `requests.json`, the number of
  Neviweb requests of the day; `signatures.json`, the model of each Neviweb
  device. Nothing else.
- **Network**: requests go only to `https://neviweb.com`, one at a time, at
  most 25,000 a day; the integration opens no port and talks to no other
  service.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Neviweb and the Sinopé devices (report to Sinopé Technologies), and the other
devices and services of your network.
