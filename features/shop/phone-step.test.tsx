import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "@/tests/msw";
import { renderOnSite } from "@/tests/render-site";
import { apiError } from "@/tests/shop-fixtures";
import { PhoneStep } from "./phone-step";

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

describe("checkout: phone step", () => {
  it("is one phone field for a Qatari mobile, typed left to right", () => {
    renderOnSite(<PhoneStep onSent={vi.fn()} />);
    const input = screen.getByLabelText("Mobile number");
    expect(input).toHaveAttribute("inputmode", "tel");
    expect(input).toHaveAttribute("dir", "ltr");
    expect(input).toHaveAttribute("autocomplete", "tel");
    expect(screen.getByText("A Qatari mobile number. We'll text you a 6-digit code.")).toBeInTheDocument();
  });

  it("keeps Send code disabled until the number is a valid Qatari mobile", async () => {
    const sent = listenForCodes();
    const { user } = renderOnSite(<PhoneStep onSent={vi.fn()} />);
    const send = screen.getByRole("button", { name: "Send code" });
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText("Mobile number"), "5512");
    expect(send).toBeDisabled();
    await user.clear(screen.getByLabelText("Mobile number"));
    // a landline is not a mobile
    await user.type(screen.getByLabelText("Mobile number"), "44123456");
    expect(send).toBeDisabled();
    await user.clear(screen.getByLabelText("Mobile number"));
    await user.type(screen.getByLabelText("Mobile number"), "+974 5512 3456");
    expect(send).toBeEnabled();
    expect(sent).toEqual([]);
  });

  it("sends the code to the number in E.164 and hands it on, with the development code when the API echoes one", async () => {
    const sent = listenForCodes(() => HttpResponse.json({ expiresAt: "2031-03-10T09:05:00.000Z", devCode: "482915" }));
    const onSent = vi.fn();
    const { user } = renderOnSite(<PhoneStep onSent={onSent} />);
    // Arabic-Indic digits are what many phones type on the Arabic keyboard
    await user.type(screen.getByLabelText("Mobile number"), "٥٥١٢٣٤٥٦");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    await waitFor(() => expect(onSent).toHaveBeenCalledWith("+97455123456", "482915"));
    expect(sent).toEqual([{ phone: "+97455123456" }]);
  });

  it("hands on no development code when the API sends none", async () => {
    listenForCodes();
    const onSent = vi.fn();
    const { user } = renderOnSite(<PhoneStep onSent={onSent} />);
    await user.type(screen.getByLabelText("Mobile number"), "55123456");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(onSent.mock.calls[0][0]).toBe("+97455123456");
    expect(onSent.mock.calls[0][1]).toBeUndefined();
  });

  it("says so when too many codes went to this number", async () => {
    listenForCodes(() => apiError(429, "OTP_TOO_MANY", { retryAfterSeconds: 840 }));
    const onSent = vi.fn();
    const { user } = renderOnSite(<PhoneStep onSent={onSent} />);
    await user.type(screen.getByLabelText("Mobile number"), "55123456");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Please wait a while and try again.");
    expect(onSent).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send code" })).toBeEnabled();
  });

  it("says when online payment is switched off", async () => {
    listenForCodes(() => apiError(503, "CHECKOUT_UNAVAILABLE"));
    const { user } = renderOnSite(<PhoneStep onSent={vi.fn()} />);
    await user.type(screen.getByLabelText("Mobile number"), "55123456");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Online payment isn't available right now. Order on WhatsApp instead.");
  });

  it("falls back to a generic message for an unexpected failure", async () => {
    listenForCodes(() => apiError(500, "INTERNAL"));
    const { user } = renderOnSite(<PhoneStep onSent={vi.fn()} />);
    await user.type(screen.getByLabelText("Mobile number"), "55123456");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  });

  it("explains what a valid number is", async () => {
    const { user } = renderOnSite(<PhoneStep onSent={vi.fn()} />);
    // a landline, then the field loses focus
    await user.type(screen.getByLabelText("Mobile number"), "44123456");
    await user.tab();
    expect(await screen.findByText("Enter a Qatari mobile number (8 digits starting with 3, 5, 6 or 7).")).toBeInTheDocument();
  });

  it("is written in Arabic on the Arabic site", () => {
    renderOnSite(<PhoneStep onSent={vi.fn()} />, { locale: "ar" });
    expect(screen.getByLabelText("رقم الجوال")).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("button", { name: "إرسال الرمز" })).toBeDisabled();
  });
});
