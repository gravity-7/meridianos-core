# Interface contracts — the arbiter in integration disputes

Contracts are written **before** parallel work is spawned. A contract fixes: exported function
signatures, data-shape fragments, and file paths. When two cards disagree at integration time, the
contract wins — not either implementation. Changing a contract is an orchestrator decision (logged);
a subagent that needs a contract change **STOPS and reports**.

| Contract | For card(s) | Seam extended |
|---|---|---|
| [intake-source.contract.md](intake-source.contract.md) | C3 | `inbox-source.mjs` (`name`/`list`/`read`/`submit`), merged #33 |
| [domain-record.contract.md](domain-record.contract.md) | C2, C5 | `config.mjs` `createAios({domain})` |
| [ledger-metering.contract.md](ledger-metering.contract.md) | C4, C9 | `usage-readers.mjs` `readUsage`, `gateway/ledger.mjs` `queryWindow` |
| [gateway-cli.contract.md](gateway-cli.contract.md) | C1 | `gateway/index.mjs` `assembleGateway` |
