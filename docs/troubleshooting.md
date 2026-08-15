# Onboarding troubleshooting

## Provider validation failed

`invalid` means the provider rejected the credential. Re-enter it and retry. `unreachable` and
`timeout` are recoverable network/provider states; confirm network access and retry. MeridianOS
shows only a fixed recovery message, not a provider response, request URL, or credential.

## I refreshed and the credential is gone

This is intentional. Browser onboarding resumes non-secret choices only. Enter the credential
again at the provider step; it is never stored in local or session storage.

## Existing setup was detected

Unified setup never overwrites `.ai/policy.yaml`, `.ai/tenant.yaml`, `.env`, or an existing
keychain credential. Return to the Dashboard or the legacy `/setup` compatibility route to manage
the installation. Repair incomplete configuration deliberately rather than deleting files to make
the wizard appear fresh.

## Electron secure storage is unavailable

Unlock the OS keychain/Credential Manager (or install the platform keychain service), then retry.
Electron blocks setup completion on this condition and does not downgrade to `.env` storage.

## Setup did not resume

Browser privacy or storage settings can block local draft persistence. Continue in the current
tab, or start again; only safe choices need to be re-entered. A provider credential must always be
entered again after a reload.
