import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { apiError, customer } from "@/tests/shop-fixtures";
import { OTP_RESEND_SECONDS } from "@/shared/shop";
import { CodeStep, type CodeStepProps } from "./code-step";

const EMAIL = "sara@example.com";
const NOW = new Date("2031-03-10T09:00:00.000Z");

function props(over: Partial<CodeStepProps> = {}): CodeStepProps {
  return { email: EMAIL, resendAt: null, onVerified: vi.fn(), onChangeEmail: vi.fn(), onResent: vi.fn(), ...over };
}

function listenForVerify(answer: (code: string) => Response) {
  const tried: unknown[] = [];
  server.use(
    http.post("/api/shop/otp/verify", async ({ request }) => {
      const body = (await request.json()) as { email: string; code: string };
      tried.push(body);
      return answer(body.code);
    }),
  );
  return tried;
}

afterEach(() => vi.useRealTimers());

describe("checkout: code step", () => {
  it("says where the code went", () => {
    renderOnSite(<CodeStep {...props()} />);
    expect(screen.getByText(/We emailed a 6-digit code to/)).toHaveTextContent("sara@example.com");
    expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
  });

  it("checks the code by itself once the sixth digit is typed", async () => {
    const me = customer();
    const tried = listenForVerify(() => HttpResponse.json({ customer: me, expiresAt: "2031-04-09T09:00:00.000Z" }));
    const p = props();
    const { user } = renderOnSite(<CodeStep {...p} />);

    await user.type(screen.getByLabelText("Verification code"), "48291");
    expect(tried).toEqual([]);
    await user.type(screen.getByLabelText("Verification code"), "5");

    await waitFor(() => expect(p.onVerified).toHaveBeenCalledWith(me));
    expect(tried).toEqual([{ email: EMAIL, code: "482915" }]);
  });

  it("says a wrong code is wrong and lets the customer type another", async () => {
    const tried = listenForVerify((code) =>
      code === "482915" ? HttpResponse.json({ customer: customer(), expiresAt: "2031-04-09T09:00:00.000Z" }) : apiError(401, "OTP_INVALID"),
    );
    const p = props();
    const { user } = renderOnSite(<CodeStep {...p} />);

    await user.type(screen.getByLabelText("Verification code"), "000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong code. Check the email and try again.");
    expect(p.onVerified).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Verification code"));
    await user.type(screen.getByLabelText("Verification code"), "482915");
    await waitFor(() => expect(p.onVerified).toHaveBeenCalledTimes(1));
    expect(tried).toHaveLength(2);
  });

  it("empties the boxes after a wrong code and gives focus back, so the next code is typed from the start", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tried: unknown[] = [];
    server.use(
      http.post("/api/shop/otp/verify", async ({ request }) => {
        const body = (await request.json()) as { email: string; code: string };
        tried.push(body);
        if (body.code === "482915") return HttpResponse.json({ customer: customer(), expiresAt: "2031-04-09T09:00:00.000Z" });
        await gate;
        return apiError(401, "OTP_INVALID");
      }),
    );
    const p = props();
    const { user } = renderOnSite(
      <>
        <CodeStep {...p} />
        <button type="button">elsewhere</button>
      </>,
    );
    const input = screen.getByLabelText("Verification code");

    await user.type(input, "000000");
    // a browser takes focus off the input it disables while the code is checked
    act(() => screen.getByRole("button", { name: "elsewhere" }).focus());
    release();
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong code. Check the email and try again.");
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("");

    // typed straight away, without clearing anything: one check for the new code, no extra wrong try
    await user.keyboard("482915");
    await waitFor(() => expect(p.onVerified).toHaveBeenCalledTimes(1));
    expect(tried).toEqual([
      { email: EMAIL, code: "000000" },
      { email: EMAIL, code: "482915" },
    ]);
  });

  it("explains a code that was guessed too often", async () => {
    listenForVerify(() => apiError(429, "OTP_TOO_MANY", { retryAfterSeconds: 600 }));
    const { user } = renderOnSite(<CodeStep {...props()} />);
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
    const { user } = renderOnSite(<CodeStep {...p} />);

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
    expect(resent).toEqual([{ email: EMAIL, locale: "en" }]);
    const next = vi.mocked(p.onResent).mock.calls[0][0];
    expect(next).toBeGreaterThanOrEqual(Date.now() + (OTP_RESEND_SECONDS - 1) * 1000);
    expect(next).toBeLessThanOrEqual(Date.now() + OTP_RESEND_SECONDS * 1000);
  });

  it("offers Resend at once when there is nothing to wait for", () => {
    renderOnSite(<CodeStep {...props({ resendAt: null })} />);
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
  });

  it("goes back to the email on Change email", async () => {
    const p = props();
    const { user } = renderOnSite(<CodeStep {...p} />);
    await user.click(screen.getByText("Change email"));
    expect(p.onChangeEmail).toHaveBeenCalledTimes(1);
  });

  it("shows the development code only when it was given one", () => {
    const { unmount } = renderOnSite(<CodeStep {...props({ devCode: "482915" })} />);
    expect(screen.getByText("Development code: 482915")).toBeInTheDocument();
    unmount();
    renderOnSite(<CodeStep {...props()} />);
    expect(screen.queryByText(/Development code/)).not.toBeInTheDocument();
  });
});
