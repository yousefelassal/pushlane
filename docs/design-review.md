# Initial design comparison

Two read-only design candidates ran in the initial implementation session on 2026-11-17. Both used the parent model. A third read-only agent judged the alternatives. Model diversity was reduced.

Candidate `/root/design_database_queue` proposed PostgreSQL notifications and deliveries committed atomically, with expiring leases claimed through `FOR UPDATE SKIP LOCKED`. It recommended project-scoped idempotency keys, installation session generations, version-checked invalidation, and durable attempt records.

Candidate `/root/design_outbox_queue` proposed a PostgreSQL transactional outbox, a publisher, Redis BullMQ scheduling, and database reconciliation for lost queue entries. It concluded that this added operational coordination before the first product needed it.

Judge `/root/judge_design` recommended PostgreSQL-only because it has one durable job authority. It required expiring leases, conditional completion, restart verification, and recovery of abandoned claims. It rejected exactly-once notification promises.

The implementation keeps the PostgreSQL-only base and the explicit recovery requirement. The public API remains independent of the queue implementation.
