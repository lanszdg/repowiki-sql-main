# GitHub PL/SQL Source-to-Facts Corpus

This corpus is a real-source acceptance set for the Oracle stored procedure/FSD source-to-facts chain.

- Sources are public GitHub raw URLs pinned by commit.
- Golden files are manual sampled facts, not generated from actual outputs.
- Recall is gated strictly for the sampled facts. Precision is reported but not gated because each golden is a sampled acceptance slice, not a full exhaustive truth set.
- Cases intentionally include current gaps, such as cursor `OPEN ... FOR`, exception handler extraction, and standalone `MERGE` SQL without a procedure/package owner. A strict run should fail until those gaps are implemented.

Run:

```powershell
.\config\bin\codegraph\node.exe .\config\skills\repowiki\plsql-source-facts-corpus.cjs --manifest .\config\skills\repowiki\eval\source-facts\github-corpus\manifest.json --out .\config\.repowiki\diagnostics\source-facts-github-corpus --strict
```
