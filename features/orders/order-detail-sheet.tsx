"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, CheckCircle2, CircleAlert, CircleMinus, Clock, FileDown, Globe, Lock, PackageCheck, Pencil, RotateCw, TriangleAlert, Undo2 } from "lucide-react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Barcode } from "@/components/barcode";
import { OrderPaymentBadge, OrderStatusBadge, Pill } from "@/components/app/badges";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ErrorState, LoadingRows } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/features/auth/auth-provider";
import { isolate } from "@/features/products/bidi";
import { api, ApiError } from "@/lib/api/client";
import type { OrderDetail } from "@/lib/api/types";
import { useErrorMessage } from "@/lib/api/use-error-message";
import { formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { localQatarNumber } from "@/shared/shop";
import { OrderEditor } from "./order-editor";
import { collectOrder, fetchOrder, orderKeys, retryOdoo } from "./queries";
import { downloadReceipt } from "./receipt";

/** "+97455123456" → "+974 5512 3456" (anything else as stored). */
function prettyPhone(e164: string): string {
  if (!/^\+974\d{8}$/.test(e164)) return e164;
  const local = localQatarNumber(e164);
  return `+974 ${local.slice(0, 4)} ${local.slice(4)}`;
}

function Meta({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("grid min-w-0 gap-0.5", className)}>
      <dt className="text-[13px] font-bold text-muted">{label}</dt>
      <dd className="min-w-0 text-[15px] break-words">{children}</dd>
    </div>
  );
}

function ReceiptButton({ order, lang, disabled, describedBy }: { order: OrderDetail; lang: "ar" | "en"; disabled: boolean; describedBy?: string }) {
  const t = useTranslations("Orders");
  const message = useErrorMessage();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={disabled || busy}
      aria-describedby={describedBy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadReceipt(order, lang);
        } catch (error) {
          toast.error(message(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <FileDown className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
      {busy ? t("downloading") : lang === "ar" ? t("receiptAr") : t("receiptEn")}
    </Button>
  );
}

type OdooState = NonNullable<OrderDetail["odoo"]>;

/** Where a paid web order stands in Odoo, with Finance's Retry while it is not there yet. */
function OdooSection({ orderId, odoo, canRetry }: { orderId: string; odoo: OdooState; canRetry: boolean }) {
  const t = useTranslations("Orders");
  const locale = useLocale();
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => retryOdoo(orderId),
    onSuccess: (updated) => {
      queryClient.setQueryData(orderKeys.detail(orderId), updated);
      toast.success(t("odooRetried"));
    },
    onError: (error) => toast.error(message(error)),
    // reload either way: the outbox may have moved on (or the order is no longer queued)
    onSettled: () => queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) }),
  });

  const headingId = `odoo-${orderId}`;
  const statusId = `odoo-status-${orderId}`;
  const notConfigured = odoo.status === "PENDING" && odoo.lastError === "ODOO_WRITE_NOT_CONFIGURED";
  // a pending row that already failed: what went wrong last time, so a failure is never hidden behind "waiting"
  const lastFailure = odoo.status === "PENDING" && odoo.attempts > 0 && odoo.lastError && !notConfigured ? odoo.lastError : null;
  const { Icon, tone, text } =
    odoo.status === "DONE"
      ? { Icon: CheckCircle2, tone: "text-success", text: t("odooDone", { id: isolate(String(odoo.saleOrderId ?? "—")) }) }
      : odoo.status === "PENDING"
        ? { Icon: Clock, tone: "text-ink-2", text: t("odooPending") }
        : odoo.lastError === "ORDER_REFUNDED"
          ? // not an Odoo failure: a refunded order is never sold in Odoo
            { Icon: CircleMinus, tone: "text-ink-2", text: t("odooRefunded") }
          : { Icon: CircleAlert, tone: "text-danger", text: t("odooFailed", { error: isolate(odoo.lastError ?? "—") }) };

  return (
    <section aria-labelledby={headingId} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-brand-lg)] border border-line p-4">
      <div className="grid min-w-0 flex-1 gap-1">
        <h3 id={headingId} className="text-[13px] font-bold text-muted">
          {t("odoo")}
        </h3>
        <p id={statusId} className={cn("flex flex-wrap items-start gap-x-2 gap-y-0.5 text-[15px] font-semibold", tone)}>
          <Icon className="mt-[3px] size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          <span className="min-w-0 break-words">{text}</span>
          {odoo.status === "PENDING" && odoo.nextAttemptAt && (
            <time dateTime={odoo.nextAttemptAt} className="font-normal text-muted">
              {formatDateTime(odoo.nextAttemptAt, locale)}
            </time>
          )}
        </p>
        {notConfigured && <p className="text-sm font-semibold text-warning">{t("odooNotConfigured")}</p>}
        {lastFailure && (
          <p className="text-sm font-semibold break-words text-warning">
            {t("odooAttemptFailed", { count: String(odoo.attempts), error: isolate(lastFailure) })}
          </p>
        )}
      </div>
      {canRetry && (
        <Button variant="outline" size="sm" disabled={retry.isPending} aria-describedby={statusId} onClick={() => retry.mutate()}>
          <RotateCw className={cn("size-4", retry.isPending && "motion-safe:animate-spin")} strokeWidth={1.8} aria-hidden="true" />
          {t("odooRetry")}
        </Button>
      )}
    </section>
  );
}

function OrderDetailBody({ id }: { id: string }) {
  const t = useTranslations("Orders");
  const tc = useTranslations("Common");
  const locale = useLocale();
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const { user, can } = useAuth();
  const order = useQuery({ queryKey: orderKeys.detail(id), queryFn: () => fetchOrder(id) });
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<"confirm" | "cancel" | "collect" | null>(null);

  const settle = (updated: OrderDetail) => {
    queryClient.setQueryData(orderKeys.detail(id), updated);
    void queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
    void queryClient.invalidateQueries({ queryKey: ["stats"] });
  };
  const fail = (error: unknown) => {
    toast.error(message(error));
    if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
      // someone else changed it (e.g. ORDER_NOT_PENDING): show the current state
      setDialog(null);
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
    }
  };
  if (order.isPending || order.isError) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>{order.isPending ? tc("loading") : t("title")}</SheetTitle>
          <SheetDescription className="sr-only">{t("title")}</SheetDescription>
        </SheetHeader>
        <SheetBody className="pb-6">
          {order.isPending ? <LoadingRows rows={5} className="h-12" /> : <ErrorState error={order.error} onRetry={() => void order.refetch()} />}
        </SheetBody>
      </>
    );
  }

  const o = order.data;
  const isAdmin = user?.role === "SUPER_ADMIN";
  const pending = o.status === "PENDING";
  const web = o.source === "WEB";
  // gated by permission AND state; the Super Admin may override the "pending only" rule (the API allows it).
  // A web order is never edited (its total is what the card was charged) nor confirmed by staff (the payment confirms it).
  const canEdit = !web && can("order.update") && (pending || isAdmin);
  const canConfirm = !web && can("order.confirm") && pending;
  const canCancel = can("order.cancel") && (pending || (isAdmin && o.status === "CONFIRMED"));
  // handing a paid web order over at the counter, once
  const canCollect = web && can("order.confirm") && o.status === "CONFIRMED" && o.paymentStatus === "PAID" && !o.collectedAt;
  // a refunded order is never sold in Odoo (its row fails with ORDER_REFUNDED), and one already there needs nothing
  const canRetryOdoo = can("order.odoo.retry") && o.odoo !== null && o.odoo.status !== "DONE" && o.paymentStatus !== "REFUNDED";
  const canReceipt = can("order.receipt.download");
  const locked = o.status === "CONFIRMED" && !canEdit && !canCancel;
  // the newest card attempt's failure: the codes staff must act on get a sentence, any other code is shown as Tap sent it
  const failureCode = o.payment?.failureCode ?? null;
  // Tap captured another amount than the total, and it has not been refunded
  const capturedMismatch = failureCode === "AMOUNT_MISMATCH" && o.payment?.status === "CAPTURED" && !o.payment.refundId;
  const paymentWarning = capturedMismatch
    ? o.status === "CANCELLED"
      ? t("amountMismatchCancelled") // cancelled without the refund (e.g. it expired first): refund it in Tap
      : t("amountMismatch")
    : failureCode === "DUPLICATE_CAPTURE"
      ? t("duplicateCapture")
      : null;
  const paymentCode = failureCode && !paymentWarning ? failureCode : null;
  // cancelling refunds the card first (OrdersService.cancel): a paid order, or one Tap charged the wrong amount
  const cancelRefunds = web && (o.paymentStatus === "PAID" || capturedMismatch);
  const branch = locale === "ar" ? o.branch.nameAr : o.branch.name;

  const act = (action: "confirm" | "cancel" | "collect") => async () => {
    try {
      const updated = action === "collect" ? await collectOrder(id) : await api<OrderDetail>(`/orders/${id}/${action}`, { method: "POST" });
      settle(updated);
      // the API answers with the order as it is now: REFUNDED when this cancel sent the money back
      const refunded = updated.paymentStatus === "REFUNDED" && o.paymentStatus !== "REFUNDED";
      toast.success(
        action === "confirm"
          ? t("confirmed", { code: o.code })
          : action === "collect"
            ? t("collected")
            : refunded
              ? t("cancelledRefunded", { code: o.code })
              : t("cancelled", { code: o.code }),
      );
    } catch (error) {
      fail(error);
      throw error;
    }
  };

  const header = (
    <SheetHeader>
      <div className="flex flex-wrap items-center gap-2">
        <SheetTitle>{t("detailTitle", { code: isolate(o.code) })}</SheetTitle>
        <OrderStatusBadge status={o.status} />
        {web && (
          <Pill>
            <Globe className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            {t("web")}
          </Pill>
        )}
        <OrderPaymentBadge order={o} />
      </div>
      <SheetDescription>{t("placedLine", { date: formatDateTime(o.createdAt, locale), name: isolate(o.createdBy.displayName) })}</SheetDescription>
    </SheetHeader>
  );

  if (editing) {
    return (
      <>
        {header}
        <OrderEditor order={o} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} onError={fail} />
      </>
    );
  }

  const receiptHintId = `receipt-hint-${o.id}`;
  return (
    <>
      {header}
      <SheetBody className="grid grid-cols-1 content-start gap-5 pb-4">
        {paymentWarning && (
          <p className="flex items-start gap-2 rounded-[var(--radius-brand)] bg-danger-soft px-3 py-2.5 text-sm font-semibold text-danger">
            <TriangleAlert className="mt-px size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            {paymentWarning}
          </p>
        )}
        {locked && (
          <p className="flex items-center gap-2 rounded-[var(--radius-brand)] bg-sand px-3 py-2.5 text-sm font-semibold text-ink-2">
            <Lock className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            {t("lockedNote")}
          </p>
        )}

        <div className="grid gap-3 rounded-[var(--radius-brand-lg)] border border-line p-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Meta label={t("customer")}>
              <span dir="auto" className="font-bold">
                {o.customerName}
              </span>
            </Meta>
            <Meta label={tc("branch")}>{branch}</Meta>
            {o.customerPhone && (
              <Meta label={t("customerPhone")}>
                <a href={`tel:${o.customerPhone}`} dir="ltr" className="font-semibold text-accent-ink underline underline-offset-2">
                  {prettyPhone(o.customerPhone)}
                </a>
              </Meta>
            )}
            {o.customerEmail && (
              <Meta label={t("customerEmail")}>
                <a href={`mailto:${o.customerEmail}`} dir="ltr" className="break-all text-accent-ink underline underline-offset-2">
                  {o.customerEmail}
                </a>
              </Meta>
            )}
            <Meta label={t("placedBy")}>
              <span dir="auto">{o.createdBy.displayName}</span>
            </Meta>
            <Meta label={t("placedAt")}>
              <time dateTime={o.createdAt}>{formatDateTime(o.createdAt, locale)}</time>
            </Meta>
            {web && (
              <Meta label={t("payment")} className="col-span-2">
                {o.payment?.chargeId || o.paidAt || paymentCode || o.payment?.refundId ? (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {o.payment?.chargeId && (
                      // the end of Tap's charge id: enough to find the charge in Tap's dashboard
                      <span dir="ltr" className="font-mono text-sm">
                        …{o.payment.chargeId.slice(-8)}
                      </span>
                    )}
                    {o.paidAt && (
                      <time dateTime={o.paidAt} className="text-ink-2">
                        {formatDateTime(o.paidAt, locale)}
                      </time>
                    )}
                    {paymentCode && (
                      <span dir="ltr" className="font-mono text-sm font-bold text-danger">
                        {paymentCode}
                      </span>
                    )}
                    {o.payment?.refundId && (
                      <span className="inline-flex flex-wrap items-center gap-x-1.5">
                        <Undo2 className="size-4 shrink-0 text-ink-2 rtl:-scale-x-100" strokeWidth={1.8} aria-hidden="true" />
                        <span className="font-bold">{t("paymentRefunded")}</span>
                        <span dir="ltr" className="font-mono text-sm break-all">
                          {o.payment.refundId}
                        </span>
                      </span>
                    )}
                  </span>
                ) : (
                  "—"
                )}
              </Meta>
            )}
          </dl>
          {o.confirmedBy && o.confirmedAt && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-success">
              <CheckCircle2 className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              <span className="font-bold">{t("confirmedBy", { name: isolate(o.confirmedBy.displayName) })}</span>
              <time dateTime={o.confirmedAt} className="text-ink-2">
                {formatDateTime(o.confirmedAt, locale)}
              </time>
            </p>
          )}
          {o.status === "CANCELLED" && o.cancelledBy && o.cancelledAt && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-danger">
              <Ban className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              <span className="font-bold">{t("cancelledBy", { name: isolate(o.cancelledBy.displayName) })}</span>
              <time dateTime={o.cancelledAt} className="text-ink-2">
                {formatDateTime(o.cancelledAt, locale)}
              </time>
            </p>
          )}
          {o.collectedAt && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-2">
              <PackageCheck className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
              <span className="font-bold text-ink">{o.collectedBy ? t("collectedBy", { name: isolate(o.collectedBy.displayName) }) : t("collected")}</span>
              <time dateTime={o.collectedAt}>{formatDateTime(o.collectedAt, locale)}</time>
            </p>
          )}
        </div>

        {web && o.odoo && <OdooSection orderId={o.id} odoo={o.odoo} canRetry={canRetryOdoo} />}

        <section aria-labelledby={`lines-${o.id}`} className="grid gap-2">
          <h3 id={`lines-${o.id}`} className="text-sm font-bold text-ink-2">
            {t("items")} · {t("lines", { count: o.items.length })}
          </h3>
          <ul className="divide-y divide-line rounded-[var(--radius-brand-lg)] border border-line">
            {o.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 p-3">
                <Image
                  src={item.thumbUrl}
                  alt=""
                  width={48}
                  height={48}
                  unoptimized
                  className="size-12 shrink-0 rounded-[var(--radius-brand)] border border-line bg-sand object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="w-fit max-w-full truncate font-bold">
                    {item.productName}
                  </p>
                  <p className="text-[13px] text-ink-2">
                    {t("quantity")}{" "}
                    <b dir="ltr" className="tabular-nums">
                      {item.quantity}
                    </b>
                    {" · "}
                    {t("unitPrice")}{" "}
                    <span className="tabular-nums">
                      {formatMoney(item.unitPrice, locale)}
                    </span>
                  </p>
                </div>
                <span className="shrink-0 text-end">
                  <span className="sr-only">{t("lineTotal")} </span>
                  <span className="font-bold tabular-nums">
                    {formatMoney(item.lineTotal, locale)}
                  </span>
                </span>
                {item.barcode && (
                  // scannable: the cashier reads this straight off the screen
                  // into the till system, so the bars matter more than the digits.
                  // A row of its own, so a phone shows every bar at full size.
                  <Barcode value={item.barcode} className="basis-full [&>svg]:h-auto [&>svg]:max-w-full" />
                )}
              </li>
            ))}
          </ul>
          <p className="flex items-center justify-between gap-3 px-1 text-[17px] font-extrabold">
            <span>{t("grandTotal")}</span>
            <span className="tabular-nums">
              {formatMoney(o.total, locale)}
            </span>
          </p>
        </section>

        {canReceipt && (
          <section aria-labelledby={`receipt-${o.id}`} className="grid gap-2">
            <h3 id={`receipt-${o.id}`} className="text-sm font-bold text-ink-2">
              {t("receipt")}
            </h3>
            <div className="flex flex-wrap gap-2">
              <ReceiptButton order={o} lang="ar" disabled={o.status !== "CONFIRMED"} describedBy={o.status !== "CONFIRMED" ? receiptHintId : undefined} />
              <ReceiptButton order={o} lang="en" disabled={o.status !== "CONFIRMED"} describedBy={o.status !== "CONFIRMED" ? receiptHintId : undefined} />
            </div>
            {o.status !== "CONFIRMED" && (
              <p id={receiptHintId} className="text-[13px] text-muted">
                {t("receiptOnlyConfirmed")}
              </p>
            )}
          </section>
        )}
      </SheetBody>

      {(canEdit || canCancel || canConfirm || canCollect) && (
        <SheetFooter className="flex-wrap">
          {canEdit && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
              {t("edit")}
            </Button>
          )}
          {canCancel && (
            <Button variant="destructive-outline" onClick={() => setDialog("cancel")}>
              <Ban className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
              {t("cancel")}
            </Button>
          )}
          {canConfirm && (
            <Button onClick={() => setDialog("confirm")}>
              <Check className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
              {t("confirm")}
            </Button>
          )}
          {canCollect && (
            <Button onClick={() => setDialog("collect")}>
              <PackageCheck className="size-[18px]" strokeWidth={1.8} aria-hidden="true" />
              {t("markCollected")}
            </Button>
          )}
        </SheetFooter>
      )}

      <ConfirmDialog
        open={dialog === "confirm"}
        onOpenChange={(open) => setDialog(open ? "confirm" : null)}
        title={t("confirmTitle", { code: isolate(o.code) })}
        body={t("confirmBody")}
        confirmLabel={t("confirm")}
        onConfirm={act("confirm")}
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => setDialog(open ? "cancel" : null)}
        title={t("cancelTitle", { code: isolate(o.code) })}
        body={cancelRefunds ? t("cancelBodyRefund") : t("cancelBody")}
        confirmLabel={t("cancel")}
        cancelLabel={t("keep")}
        destructive
        onConfirm={act("cancel")}
      />
      <ConfirmDialog
        open={dialog === "collect"}
        onOpenChange={(open) => setDialog(open ? "collect" : null)}
        title={t("collectTitle", { code: isolate(o.code) })}
        body={t("collectBody")}
        confirmLabel={t("markCollected")}
        onConfirm={act("collect")}
      />
    </>
  );
}

/** Side sheet with one order: details, line items and the actions this user may take. */
export function OrderDetailSheet({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const tc = useTranslations("Common");
  // keep showing the last order while the sheet animates out
  const [shownId, setShownId] = useState(orderId);
  if (orderId !== null && orderId !== shownId) setShownId(orderId);
  return (
    <Sheet
      open={orderId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="end" closeLabel={tc("close")} className="sm:max-w-xl">
        {shownId && <OrderDetailBody key={shownId} id={shownId} />}
      </SheetContent>
    </Sheet>
  );
}
