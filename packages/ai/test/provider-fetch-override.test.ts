import { describe, expect, it } from "bun:test";
import { streamOpenAICompletions } from "@oh-my-pi/pi-ai/providers/openai-completions";
import { streamOpenAIResponses } from "@oh-my-pi/pi-ai/providers/openai-responses";
import type { Context, FetchImpl, Model } from "@oh-my-pi/pi-ai/types";
import { disableNativeFetchTimeout } from "@oh-my-pi/pi-ai/utils/native-fetch-timeout";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";

const openAIResponsesModel = getBundledModel("openai", "gpt-5-mini") as Model<"openai-responses">;
type NativeFetchTimeout = false | number;

interface NativeTimeoutRequestInit extends RequestInit {
	timeout?: NativeFetchTimeout;
}

function getNativeFetchTimeout(init: RequestInit | undefined): NativeFetchTimeout | undefined {
	const nativeInit: NativeTimeoutRequestInit | undefined = init;
	return nativeInit?.timeout;
}

const openAICompletionsModel = {
	...(getBundledModel("openai", "gpt-4o-mini") as Model<"openai-completions">),
	api: "openai-completions",
} satisfies Model<"openai-completions">;

function baseContext(): Context {
	return {
		messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
	};
}

function createSseResponse(events: unknown[]): Response {
	const payload = `${events.map(event => `data: ${typeof event === "string" ? event : JSON.stringify(event)}`).join("\n\n")}\n\n`;
	return new Response(payload, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

describe("disableNativeFetchTimeout", () => {
	it("passes timeout false while preserving Bun preconnect", async () => {
		const calls: Array<{ timeout: NativeFetchTimeout | undefined }> = [];
		const baseFetch: FetchImpl = Object.assign(
			async (_input: string | URL | Request, init?: RequestInit) => {
				calls.push({ timeout: getNativeFetchTimeout(init) });
				return new Response("ok");
			},
			{ preconnect: fetch.preconnect },
		);
		const wrappedFetch = disableNativeFetchTimeout(baseFetch);

		const response = await wrappedFetch("https://example.com", { method: "POST" });

		expect(await response.text()).toBe("ok");
		expect(calls).toEqual([{ timeout: false }]);
		expect(wrappedFetch.preconnect).toBe(fetch.preconnect);
	});
});

describe("StreamOptions.fetch override", () => {
	it("routes openai-completions requests through the override", async () => {
		const calls: Array<{ url: string; timeout: NativeFetchTimeout | undefined }> = [];

		const customFetch: FetchImpl = Object.assign(
			async (input: string | URL | Request, init?: RequestInit) => {
				calls.push({
					url: String(input instanceof Request ? input.url : input),
					timeout: getNativeFetchTimeout(init),
				});
				return createSseResponse([
					{
						id: "chatcmpl-test",
						object: "chat.completion.chunk",
						created: 0,
						model: openAICompletionsModel.id,
						choices: [{ index: 0, delta: { content: "hi" } }],
					},
					{
						id: "chatcmpl-test",
						object: "chat.completion.chunk",
						created: 0,
						model: openAICompletionsModel.id,
						choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					},
					"[DONE]",
				]);
			},
			{ preconnect: fetch.preconnect },
		);

		const result = await streamOpenAICompletions(openAICompletionsModel, baseContext(), {
			apiKey: "test-key",
			fetch: customFetch,
		}).result();

		expect(result.stopReason).toBe("stop");
		expect(calls.length).toBeGreaterThanOrEqual(1);
		expect(calls[0]).toMatchObject({ timeout: false, url: expect.stringContaining("/chat/completions") });
	});

	it("routes openai-responses requests through the override", async () => {
		const calls: Array<{ url: string; timeout: NativeFetchTimeout | undefined }> = [];

		const customFetch: FetchImpl = Object.assign(
			async (input: string | URL | Request, init?: RequestInit) => {
				calls.push({
					url: String(input instanceof Request ? input.url : input),
					timeout: getNativeFetchTimeout(init),
				});
				return createSseResponse([
					{ type: "response.created", response: { id: "resp_test" } },
					{
						type: "response.output_item.added",
						item: { type: "message", id: "msg_test", role: "assistant", status: "in_progress", content: [] },
					},
					{ type: "response.content_part.added", part: { type: "output_text", text: "" } },
					{ type: "response.output_text.delta", delta: "hi" },
					{
						type: "response.output_item.done",
						item: {
							type: "message",
							id: "msg_test",
							role: "assistant",
							status: "completed",
							content: [{ type: "output_text", text: "hi" }],
						},
					},
					{
						type: "response.completed",
						response: {
							id: "resp_test",
							status: "completed",
							usage: {
								input_tokens: 1,
								output_tokens: 1,
								total_tokens: 2,
								input_tokens_details: { cached_tokens: 0 },
							},
						},
					},
				]);
			},
			{ preconnect: fetch.preconnect },
		);

		const result = await streamOpenAIResponses(openAIResponsesModel, baseContext(), {
			apiKey: "test-key",
			fetch: customFetch,
		}).result();

		expect(result.stopReason).toBe("stop");
		expect(calls.length).toBeGreaterThanOrEqual(1);
		expect(calls[0]).toMatchObject({ timeout: false, url: expect.stringContaining("/responses") });
	});
});
