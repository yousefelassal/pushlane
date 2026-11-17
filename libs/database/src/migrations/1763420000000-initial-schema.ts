import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Creates the Pushlane schema. Generated from the entities in `../entities`. */

export class InitialSchema1763420000000 implements MigrationInterface {
  name = 'InitialSchema1763420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "projects" ("id" uuid NOT NULL, "name" text NOT NULL, "environment" text NOT NULL, "plan" text NOT NULL, "api_key_hash" text NOT NULL, "credentials_ciphertext" text NOT NULL, "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_20cbc245aac70eaa6254c82b66f" UNIQUE ("api_key_hash"), CONSTRAINT "CHK_5af4ed04c50920b33128eea0d7" CHECK ("plan" IN ('free', 'pro', 'self_hosted')), CONSTRAINT "CHK_92a6bc3ff66ed48e116afbc7c4" CHECK ("environment" IN ('development', 'production')), CONSTRAINT "CHK_c14610b0a4d0ed110a7ca8102c" CHECK (length("name") BETWEEN 1 AND 200), CONSTRAINT "PK_6271df0a7aed1d6c0691ce6ac50" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE TABLE "installation_sessions" ("id" uuid NOT NULL, "project_id" uuid NOT NULL, "installation_id" uuid NOT NULL, "user_id" text NOT NULL, "token_hash" text NOT NULL, "expires_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP(3) WITH TIME ZONE, "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_75d70ad882adf5288666f309973" UNIQUE ("token_hash"), CONSTRAINT "installation_sessions_project_id_id" UNIQUE ("project_id", "id"), CONSTRAINT "PK_cc6ec5c3968820e5d3dc7ab0275" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "installation_sessions_active" ON "installation_sessions"  ("project_id", "installation_id") WHERE "revoked_at" IS NULL`
    );
    await queryRunner.query(
      `CREATE TABLE "installations" ("project_id" uuid NOT NULL, "id" uuid NOT NULL, "user_id" text NOT NULL, "session_id" uuid NOT NULL, "provider" text NOT NULL, "endpoint_hash" text NOT NULL, "endpoint_ciphertext" text NOT NULL, "endpoint_fingerprint" text NOT NULL, "version" integer NOT NULL DEFAULT '1', "revoked_at" TIMESTAMP(3) WITH TIME ZONE, "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_8cb01e0c838a351b6e50ff5fd5" CHECK ("provider" IN ('apns', 'fcm', 'webpush')), CONSTRAINT "PK_83aef3075fc37309174d56df4f9" PRIMARY KEY ("project_id", "id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "installations_user" ON "installations"  ("project_id", "user_id") WHERE "revoked_at" IS NULL`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "installations_active_endpoint" ON "installations"  ("project_id", "endpoint_hash") WHERE "revoked_at" IS NULL`
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL, "project_id" uuid NOT NULL, "user_id" text NOT NULL, "idempotency_key" text NOT NULL, "request_hash" text NOT NULL, "payload" jsonb NOT NULL, "delivery_count" integer NOT NULL, "expires_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "notifications_project_id_id" UNIQUE ("project_id", "id"), CONSTRAINT "notifications_idempotency" UNIQUE ("project_id", "idempotency_key"), CONSTRAINT "CHK_1ae78dd4e0ee6835bc24ffb049" CHECK ("delivery_count" >= 0), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "notifications_user_logs" ON "notifications"  ("project_id", "user_id", "created_at", "id") `
    );
    await queryRunner.query(
      `CREATE INDEX "notifications_logs" ON "notifications"  ("project_id", "created_at", "id") `
    );
    await queryRunner.query(
      `CREATE TABLE "deliveries" ("id" uuid NOT NULL, "project_id" uuid NOT NULL, "notification_id" uuid NOT NULL, "installation_id" uuid NOT NULL, "session_id" uuid NOT NULL, "endpoint_version" integer NOT NULL, "provider" text NOT NULL, "status" text NOT NULL DEFAULT 'queued', "attempt_count" integer NOT NULL DEFAULT '0', "next_attempt_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "lease_token" uuid, "lease_expires_at" TIMESTAMP(3) WITH TIME ZONE, "provider_message_id" text, "last_error" text, "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "deliveries_notification_installation" UNIQUE ("notification_id", "installation_id"), CONSTRAINT "CHK_0ff597407c2eda65e47e3ad284" CHECK ("status" IN ('queued', 'processing', 'provider_accepted', 'retrying', 'failed', 'expired', 'suppressed')), CONSTRAINT "CHK_991828d574e3a5aa249fe37360" CHECK ("provider" IN ('apns', 'fcm', 'webpush')), CONSTRAINT "PK_a6ef225c5c5f0974e503bfb731f" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE INDEX "deliveries_notification" ON "deliveries"  ("project_id", "notification_id") `
    );
    await queryRunner.query(
      `CREATE INDEX "deliveries_leases" ON "deliveries"  ("lease_expires_at") WHERE "status" = 'processing'`
    );
    await queryRunner.query(
      `CREATE INDEX "deliveries_pending" ON "deliveries"  ("next_attempt_at") WHERE "status" IN ('queued', 'retrying')`
    );
    await queryRunner.query(
      `CREATE TABLE "delivery_attempts" ("delivery_id" uuid NOT NULL, "attempt" integer NOT NULL, "started_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, "finished_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "result" text NOT NULL, "code" text, CONSTRAINT "CHK_d3f71a498213e6309a098f1a15" CHECK ("result" IN ('accepted', 'retry', 'rejected', 'expired', 'suppressed')), CONSTRAINT "PK_8f45eec1a24d272c677e5798b3b" PRIMARY KEY ("delivery_id", "attempt"))`
    );
    await queryRunner.query(
      `CREATE TABLE "monthly_usage" ("project_id" uuid NOT NULL, "month" date NOT NULL, "reserved_dispatches" integer NOT NULL DEFAULT '0', CONSTRAINT "CHK_ac58e95b994a7734cc2a8a6f38" CHECK ("reserved_dispatches" >= 0), CONSTRAINT "PK_735fd35c951a3277c2757486188" PRIMARY KEY ("project_id", "month"))`
    );
    await queryRunner.query(
      `ALTER TABLE "installation_sessions" ADD CONSTRAINT "FK_fc4336101d03d3f60ab64c2ffad" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "installations" ADD CONSTRAINT "FK_d336da572b80591d2547a85bde4" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "installations" ADD CONSTRAINT "FK_b528b874cece85ada6a32f0a205" FOREIGN KEY ("project_id", "session_id") REFERENCES "installation_sessions"("project_id","id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_95464140d7dc04d7efb0afd6be0" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "deliveries" ADD CONSTRAINT "FK_603da9aee59a950a426122203bc" FOREIGN KEY ("project_id", "session_id") REFERENCES "installation_sessions"("project_id","id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "deliveries" ADD CONSTRAINT "FK_1bc50507c7281da040d7c33b300" FOREIGN KEY ("project_id", "installation_id") REFERENCES "installations"("project_id","id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "deliveries" ADD CONSTRAINT "FK_3bc206b2901304dac2223e7c9c6" FOREIGN KEY ("project_id", "notification_id") REFERENCES "notifications"("project_id","id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_attempts" ADD CONSTRAINT "FK_a9d7e7212c87084249a641ab455" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`
    );
    await queryRunner.query(
      `ALTER TABLE "monthly_usage" ADD CONSTRAINT "FK_2960411358a2549fc096cf0916e" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "monthly_usage" DROP CONSTRAINT "FK_2960411358a2549fc096cf0916e"`
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_attempts" DROP CONSTRAINT "FK_a9d7e7212c87084249a641ab455"`
    );
    await queryRunner.query(
      `ALTER TABLE "deliveries" DROP CONSTRAINT "FK_3bc206b2901304dac2223e7c9c6"`
    );
    await queryRunner.query(
      `ALTER TABLE "deliveries" DROP CONSTRAINT "FK_1bc50507c7281da040d7c33b300"`
    );
    await queryRunner.query(
      `ALTER TABLE "deliveries" DROP CONSTRAINT "FK_603da9aee59a950a426122203bc"`
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_95464140d7dc04d7efb0afd6be0"`
    );
    await queryRunner.query(
      `ALTER TABLE "installations" DROP CONSTRAINT "FK_b528b874cece85ada6a32f0a205"`
    );
    await queryRunner.query(
      `ALTER TABLE "installations" DROP CONSTRAINT "FK_d336da572b80591d2547a85bde4"`
    );
    await queryRunner.query(
      `ALTER TABLE "installation_sessions" DROP CONSTRAINT "FK_fc4336101d03d3f60ab64c2ffad"`
    );
    await queryRunner.query(`DROP TABLE "monthly_usage"`);
    await queryRunner.query(`DROP TABLE "delivery_attempts"`);
    await queryRunner.query(`DROP INDEX "public"."deliveries_pending"`);
    await queryRunner.query(`DROP INDEX "public"."deliveries_leases"`);
    await queryRunner.query(`DROP INDEX "public"."deliveries_notification"`);
    await queryRunner.query(`DROP TABLE "deliveries"`);
    await queryRunner.query(`DROP INDEX "public"."notifications_logs"`);
    await queryRunner.query(`DROP INDEX "public"."notifications_user_logs"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP INDEX "public"."installations_active_endpoint"`);
    await queryRunner.query(`DROP INDEX "public"."installations_user"`);
    await queryRunner.query(`DROP TABLE "installations"`);
    await queryRunner.query(`DROP INDEX "public"."installation_sessions_active"`);
    await queryRunner.query(`DROP TABLE "installation_sessions"`);
    await queryRunner.query(`DROP TABLE "projects"`);
  }
}
