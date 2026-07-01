export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { SuccessClient } from "./success-client";

export default async function SignupSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const params = await searchParams;
  return <SuccessClient sessionId={params.session_id ?? null} />;
}
