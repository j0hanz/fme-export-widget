import { describe, expect, it, jest } from "@jest/globals";
import { ParameterType } from "../config/index";
import type { WorkspaceParameter } from "../config/types";
import { FmeFlowApiClient } from "../shared/api";
import { normalizeFmeServiceInfo } from "../shared/utils/fme";
import { summarizeGeometryParameters } from "../shared/utils/geometry";
import { isValidExternalUrlForOptGetUrl } from "../shared/validations";

const baseConfig = {
  serverUrl: "https://example.com",
  token: "[TOKEN]",
  repository: "demoRepo",
};

interface RunContext {
  config: typeof baseConfig;
  resolveRepository: (repository?: string) => string;
  resolveServiceMode: (params?: { [key: string]: unknown }) => "sync" | "async";
  submitJob: jest.Mock;
  runDataDownload: jest.Mock;
}

const createRunContext = (mode: "sync" | "async"): RunContext => {
  const context: RunContext = {
    config: { ...baseConfig },
    resolveRepository(repository?: string) {
      return repository || this.config.repository;
    },
    resolveServiceMode: () => mode,
    submitJob: jest.fn(() =>
      Promise.resolve({ data: {}, status: 200, statusText: "OK" })
    ),
    runDataDownload: jest.fn(() =>
      Promise.resolve({ data: {}, status: 200, statusText: "OK" })
    ),
  };

  return context;
};

const runWorkspace = Reflect.get(
  FmeFlowApiClient.prototype as unknown as { [key: string]: unknown },
  "runWorkspace"
) as FmeFlowApiClient["runWorkspace"];

const formatJobParams = Reflect.get(
  FmeFlowApiClient.prototype as unknown as { [key: string]: unknown },
  "formatJobParams"
) as (params: { [key: string]: unknown }) => {
  publishedParameters: Array<{
    readonly name: string;
    readonly value: unknown;
  }>;
  TMDirectives?: { readonly [key: string]: unknown };
};

describe("FmeFlowApiClient", () => {
  it("routes async jobs to submitJob", async () => {
    const context = createRunContext("async");

    await runWorkspace.call(context, "demo", {}, undefined, undefined);

    expect(context.submitJob).toHaveBeenCalledWith(
      "demo",
      {},
      baseConfig.repository,
      undefined
    );
    expect(context.runDataDownload).not.toHaveBeenCalled();
  });

  it("routes sync jobs to webhook", async () => {
    const context = createRunContext("sync");

    await runWorkspace.call(
      context,
      "demo",
      { opt_servicemode: "sync" },
      undefined,
      undefined
    );

    expect(context.runDataDownload).toHaveBeenCalledWith(
      "demo",
      { opt_servicemode: "sync" },
      baseConfig.repository,
      undefined
    );
  });

  it("formats submit payload with TM directives", () => {
    const payload = formatJobParams({
      param1: "value",
      tm_ttc: "45",
      tm_ttl: 120,
    });

    expect(payload.publishedParameters).toEqual(
      expect.arrayContaining([{ name: "param1", value: "value" }])
    );
    expect(payload.publishedParameters).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ name: "tm_ttc" }),
        expect.objectContaining({ name: "tm_ttl" }),
      ])
    );
    expect(payload.TMDirectives).toEqual({ ttc: 45, ttl: 120 });
  });
});

describe("normalizeFmeServiceInfo", () => {
  it("captures response mode", () => {
    const info = normalizeFmeServiceInfo({
      data: {
        serviceResponse: {
          statusInfo: {
            status: "SUCCESS",
            message: "done",
            mode: "sync",
          },
          jobID: 42,
          url: "https://example.com/result.zip",
        },
      },
    });

    expect(info.mode).toBe("sync");
    expect(info.jobId).toBe(42);
  });
});

describe("summarizeGeometryParameters", () => {
  it("flags multiple geometry inputs", () => {
    const params: WorkspaceParameter[] = [
      { name: "GEOM_A", type: ParameterType.GEOMETRY, optional: false },
      { name: "GEOM_B", type: ParameterType.GEOMETRY, optional: false },
      { name: "NAME", type: ParameterType.STRING, optional: true },
    ];

    const summary = summarizeGeometryParameters(params);
    expect(summary.warning).toBe(true);
    expect(summary.count).toBe(2);
    expect(summary.names).toEqual(["GEOM_A", "GEOM_B"]);
  });
});

describe("isValidExternalUrlForOptGetUrl", () => {
  it("allows ftp URLs but rejects insecure http", () => {
    expect(
      isValidExternalUrlForOptGetUrl("ftp://files.example.com/data.zip")
    ).toBe(true);
    expect(
      isValidExternalUrlForOptGetUrl("http://files.example.com/data.zip")
    ).toBe(false);
  });
});
