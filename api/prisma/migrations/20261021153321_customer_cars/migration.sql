-- CreateTable
CREATE TABLE "customer_cars" (
    "customer_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_cars_pkey" PRIMARY KEY ("customer_id","category_id")
);

-- CreateIndex
CREATE INDEX "customer_cars_category_id_idx" ON "customer_cars"("category_id");

-- AddForeignKey
ALTER TABLE "customer_cars" ADD CONSTRAINT "customer_cars_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_cars" ADD CONSTRAINT "customer_cars_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
