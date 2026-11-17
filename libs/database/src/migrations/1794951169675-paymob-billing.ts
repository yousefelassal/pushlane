import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds Paymob payments and paid Pro periods. Generated from the entities in `../entities`. */

export class PaymobBilling1794951169675 implements MigrationInterface {
  name = 'PaymobBilling1794951169675';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "payments" ("id" uuid NOT NULL, "project_id" uuid NOT NULL, "status" text NOT NULL, "amount_cents" integer NOT NULL, "currency" text NOT NULL, "paymob_order_id" text NOT NULL, "transaction_id" text, "created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), "paid_at" TIMESTAMP(3) WITH TIME ZONE, CONSTRAINT "UQ_0565093e103474a457750b87af3" UNIQUE ("paymob_order_id"), CONSTRAINT "UQ_3c324ca49dabde7ffc0ef64675d" UNIQUE ("transaction_id"), CONSTRAINT "CHK_3eadb79cd001185842068b9581" CHECK ("amount_cents" > 0), CONSTRAINT "CHK_00684fa6d6b138f9f148616083" CHECK (("status" = 'paid') = ("transaction_id" IS NOT NULL AND "paid_at" IS NOT NULL)), CONSTRAINT "CHK_0799b4525119b19cac801d2099" CHECK ("status" IN ('pending', 'paid')), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `ALTER TABLE "projects" ADD "plan_expires_at" TIMESTAMP(3) WITH TIME ZONE`
    );
    await queryRunner.query(
      `ALTER TABLE "projects" ADD CONSTRAINT "CHK_bd45e1e170b4bd3bbe5021d606" CHECK ("plan_expires_at" IS NULL OR "plan" = 'pro')`
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD CONSTRAINT "FK_7679cab4a6968de68c2a1a8faf2" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payments" DROP CONSTRAINT "FK_7679cab4a6968de68c2a1a8faf2"`
    );
    await queryRunner.query(
      `ALTER TABLE "projects" DROP CONSTRAINT "CHK_bd45e1e170b4bd3bbe5021d606"`
    );
    await queryRunner.query(`ALTER TABLE "projects" DROP COLUMN "plan_expires_at"`);
    await queryRunner.query(`DROP TABLE "payments"`);
  }
}
