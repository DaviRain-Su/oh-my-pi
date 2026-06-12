import type { FetchImpl } from "../types";

type NativeTimeoutInit = RequestInit & { timeout: false };

/** Wraps provider fetches so Bun's native 300s TTFT timeout cannot preempt stream watchdogs. */
export function disableNativeFetchTimeout(fetchImpl: FetchImpl): FetchImpl {
	const wrappedFetch: FetchImpl = Object.assign(
		async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const nativeTimeoutInit: NativeTimeoutInit = { ...(init ?? {}), timeout: false };
			return fetchImpl(input, nativeTimeoutInit);
		},
		fetchImpl.preconnect ? { preconnect: fetchImpl.preconnect } : {},
	);
	return wrappedFetch;
}
