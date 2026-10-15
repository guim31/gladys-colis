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

In scope: the code of this repository and the Docker image it publishes. The
integration stores in `/data/parcels.json` the tracked and archived parcels
(number, name, carrier, last events) and the count of the DHL requests of the
day. The 17TRACK and DHL API keys are kept by Gladys in the integration's
configuration, sent only to `https://api.17track.net` (in the `17token`
header) and to `https://api-eu.dhl.com` (in the `DHL-API-Key` header), and
never written to the logs. The tracking numbers are sent to these two services
only. The container makes no other network request and opens no port.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the 17TRACK and DHL APIs.
