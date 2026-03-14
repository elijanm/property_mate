# MongoDB Modeling & Indexing

- Multi-tenant schema modeling (org_id-first compound indexes)
- Transactions: lease activation, invoice issue → ledger post, payment confirm → allocation
- Sharding readiness: choose shard keys that align with query shapes (org_id + property_id)
- Performance profiling: slow query detection and index iteration
