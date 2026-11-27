// Keep this window aligned with Polar's BF30 discount (UTC).
export const promotion = Object.freeze({
  code: "BF30",
  startsAt: Date.parse("2026-11-27T15:04:11Z"),
  endsAt: Date.parse("2026-12-04T15:04:11Z"),
});

export function salePrice(price) {
  return (Math.round(Number(price) * 100 * 0.7) / 100).toFixed(2);
}

export function saleCheckoutUrl(checkout) {
  if (!checkout) return null;
  const url = new URL(checkout);
  url.searchParams.set("discount_code", promotion.code);
  return url.href;
}
