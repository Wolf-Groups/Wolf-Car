import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { apiError, customer } from "@/tests/shop-fixtures";
import { OTP_RESEND_SECONDS } from "@/shared/shop";
import { OtpStep, type OtpStepProps } from "./otp-step";

const PHONE = "+97455123456";
const NOW = new Date("2031-03-10T09:00:00.000Z");

function props(over: Partial<OtpStepProps> = {}): OtpStepProps {
  return { phone: PHONE, resendAt: null, onVerified: vi.fn(), onChangePhone: vi.fn(), onResent: vi.fn(), ...over };
}

function listenForVerify(answer: (code: string) => Response) {
  const tried: unknown[] = [];
  server.use(
    http.post("/api/shop/otp/verify", async ({ request }) => {
      const body = (await request.json()) as { phone: string; code: string };
      tried.push(body);
      return answer(body.code);
    }),
  );
  return tried;
}

afterEach(() => vi.useRealTimers());

describe("checkout: code step", () => {
  it("says where the code went", () => {
    renderOnSite(<OtpStep {...props()} />);
    expect(screen.getByText(/We sent a 6-digit code to/)).toHaveTextContent(/55\s?12\s?34\s?56|5512\s?3456/);
    expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
  });

  it("checks the code by itself once the sixth digit is typed", async () => {
    const me = customer();
    const tried = listenForVerify(() => HttpResponse.json({ customer: me, expiresAt: "2031-04-09T09:00:00.000Z" }));
    const p = props();
    const { user } = renderOnSite(<OtpStep {...p} />);

    await user.type(screen.getByLabelText("Verification code"), "48291");
    expect(tried).toEqual([]);
    await user.type(screen.getByLabelText("Verification code"), "5");

    await waitFor(() => expect(p.onVerified).toHaveBeenCalledWith(me));
    expect(tried).toEqual([{ phone: PHONE, code: "482915" }]);
  });

  it("says a wrong code is wrong and lets the customer type another", async () => {
    const tried = listenForVerify((code) =>
      code === "482915" ? HttpResponse.json({ customer: customer(), expiresAt: "2031-04-09T09:00:00.000Z" }) : apiError(401, "OTP_INVALID"),
    );
    const p = props();
    const { user } = renderOnSite(<OtpStep {...p} />);

    await user.type(screen.getByLabelText("Verification code"), "000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong code. Check the message and try again.");
    expect(p.onVerified).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Verification code"));
    await user.type(screen.getByLabelText("Verification code"), "482915");
    await waitFor(() => expect(p.onVerified).toHaveBeenCalledTimes(1));
    expect(tried).toHaveLength(2);
  });

  it("explains a code that was guessed too often", async () => {
    listenForVerify(() => apiError(429, "OTP_TOO_MANY", { retryAfterSeconds: 600 }));
    const { user } = renderOnSite(<OtpStep {...props()} />);
    await user.type(screen.getByLabelText("Verification code"), "123456");
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Please wait a while and try again.");
  });

  it("holds Resend until resendAt with a live countdown, then sends a new code", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    const resent: unknown[] = [];
    server.use(
      http.post("/api/shop/otp", async ({ request }) => {
        resent.push(await request.json());
        return HttpResponse.json({ expiresAt: "2031-03-10T09:06:00.000Z" });
      }),
    );
    const p = props({ resendAt: NOW.getTime() + OTP_RESEND_SECONDS * 1000 });
    const { user } = renderOnSite(<OtpStep {...p} />);

    // the label may switch ("Resend in 42s" → "Resend code") or sit next to a disabled "Resend code"
    const resend = () => screen.getByRole("button", { name: /^Resend/ });
    expect(resend()).toBeDisabled();
    expect(screen.getByText(/Resend in (59|60)s/)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(30_000));
    expect(resend()).toBeDisabled();
    expect(screen.getByText(/Resend in (29|30)s/)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(31_000));
    expect(resend()).toBeEnabled();
    expect(resend()).toHaveAccessibleName("Resend code");
    expect(screen.queryByText(/Resend in \d+s/)).not.toBeInTheDocument();

    await user.click(resend());
    await waitFor(() => expect(p.onResent).toHaveBeenCalledTimes(1));
    expect(resent).toEqual([{ phone: PHONE }]);
    const next = vi.mocked(p.onResent).mock.calls[0][0];
    expect(next).toBeGreaterThanOrEqual(Date.now() + (OTP_RESEND_SECONDS - 1) * 1000);
    expect(next).toBeLessThanOrEqual(Date.now() + OTP_RESEND_SECONDS * 1000);
  });

  it("offers Resend at once when there is nothing to wait for", () => {
    renderOnSite(<OtpStep {...props({ resendAt: null })} />);
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("goes back to the phone number on Change number", async () => {
    const p = props();
    const { user } = renderOnSite(<OtpStep {...p} />);
    // a link-styled button or a link: either way it reads "Change number"
    await user.click(screen.getByText("Change number"));
    expect(p.onChangePhone).toHaveBeenCalledTimes(1);
  });

  it("shows the development code only when it was given one", () => {
    const { unmount } = renderOnSite(<OtpStep {...props({ devCode: "482915" })} />);
    expect(screen.getByText("Development code: 482915")).toBeInTheDocument();
    unmount();
    renderOnSite(<OtpStep {...props()} />);
    expect(screen.queryByText(/Development code/)).not.toBeInTheDocument();
  });
});
