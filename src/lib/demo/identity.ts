import crypto from "node:crypto"

export function normalizeCompanyName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(company|well|pump|water|service|services|repair|llc|inc|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizeWebsiteDomain(input: string) {
  const withProtocol = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`
  try {
    const hostname = new URL(withProtocol).hostname.toLowerCase()
    return hostname.replace(/^www\./, "")
  } catch {
    return input.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
  }
}

export function hashValue(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

export function requestIpHash(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || ""
  const realIp = request.headers.get("x-real-ip") || ""
  const ip = forwardedFor.split(",")[0]?.trim() || realIp.trim()
  return ip ? hashValue(ip).slice(0, 32) : ""
}
