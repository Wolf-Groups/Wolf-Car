import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { apiError } from "@/tests/shop-fixtures";
import { EmailStep } from "./email-step";

function listenForCodes(answer: () => Response = () => HttpResponse.json({ expiresAt: "2031-03-10T09:05:00.000Z" })) {
  const sent: unknown[] = [];
  server.use(
    http.post("/api/shop/otp", async ({ request }) => {
      sent.push(await request.json());
      return answer();
    }),
  );
  return sent;
}

describe("sign-in: email step", () => {
  it("is one email field, typed left to right", () => {
    renderOnSite(<EmailStep onSent={vi.fn()} />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("dir", "ltr");
    expect(input).toHaveAttribute("autocomplete", "email");
    expect(screen.getByText("We'll email you a 6-digit code.")).toBeInTheDocument();
  });

  it("keeps Send code disabled until the address looks like an email", async () => {
    const sent = listenForCodes();
    const { user } = renderOnSite(<EmailStep onSent={vi.fn()} />);
    const send = screen.getByRole("button", { name: "Send code" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Email"), "sara@");
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Email"), "example.com");
    expect(send).toBeEnabled();
    expect(sent).toEqual([]);
  });

  it("sends the code to the lower-cased address in the site's language, and hands on the development code", async () => {
    const sent = listenForCodes(() => HttpResponse.json({ expiresAt: "2031-03-10T09:05:00.000Z", devCode: "482915" }));
    const onSent = vi.fn();
    const { user } = renderOnSite(<EmailStep onSent={onSent} />, { locale: "ar" });
    await user.type(screen.getByLabelText("البريد الإلكتروني"), " Sara@Example.com ");
    await user.click(screen.getByRole("button", { name: "إرسال الرمز" }));
    await waitFor(() => expect(onSent).toHaveBeenCalledWith("sara@example.com", "482915"));
    expect(sent).toEqual([{ email: "sara@example.com", locale: "ar" }]);
  });

  it("says so when too many codes went to this address", async () => {
    listenForCodes(() => apiError(429, "OTP_TOO_MANY", { retryAfterSeconds: 840 }));
    const onSent = vi.fn();
    const { user } = renderOnSite(<EmailStep onSent={onSent} />);
    await user.type(screen.getByLabelText("Email"), "sara@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Please wait a while and try again.");
    expect(onSent).not.toHaveBeenCalled();
  });

  it("says when sign-in is not available yet", async () => {
    listenForCodes(() => apiError(503, "SIGN_IN_UNAVAILABLE"));
    const { user } = renderOnSite(<EmailStep onSent={vi.fn()} />);
    await user.type(screen.getByLabelText("Email"), "sara@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Signing in isn't available right now. You can still order without an account.");
  });

  it("explains what a valid address is", async () => {
    const { user } = renderOnSite(<EmailStep onSent={vi.fn()} />);
    await user.type(screen.getByLabelText("Email"), "sara");
    await user.tab();
    expect(await screen.findByText("Enter a valid email address, like name@example.com.")).toBeInTheDocument();
  });
});
