const CLOUDCONVERT_API = "https://api.cloudconvert.com/v2";

type CloudConvertTask = {
  id: string;
  name: string;
  operation: string;
  status: string;
  result?: {
    files?: Array<{
      filename: string;
      url: string;
      size?: number;
    }>;
  };
  code?: string;
  message?: string;
};

export type CloudConvertJob = {
  id: string;
  status: string;
  tasks: CloudConvertTask[];
  message?: string;
};

function apiKey() {
  const value = process.env.CLOUDCONVERT_API_KEY;
  if (!value) throw new Error("CloudConvert API 키가 설정되지 않았습니다.");
  return value;
}

async function cloudConvertRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${CLOUDCONVERT_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey()}`,
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.message || body?.error || `HTTP ${response.status}`;
    throw new Error(`CloudConvert 요청 실패: ${message}`);
  }
  return body.data as T;
}

export async function createPresentationPdfJob(params: {
  sourceUrl: string;
  fileName: string;
  candidateId: string;
}) {
  const inputFormat = params.fileName.split(".").pop()?.toLowerCase();
  if (!inputFormat || !["ppt", "pptx"].includes(inputFormat)) {
    throw new Error("현재 자동 변환은 PPT 또는 PPTX 원본만 지원합니다.");
  }

  return cloudConvertRequest<CloudConvertJob>("/jobs", {
    method: "POST",
    body: JSON.stringify({
      tag: `woolim-portfolio:${params.candidateId}`,
      tasks: {
        "import-source": {
          operation: "import/url",
          url: params.sourceUrl,
          filename: params.fileName,
        },
        "convert-pdf": {
          operation: "convert",
          input: "import-source",
          input_format: inputFormat,
          output_format: "pdf",
        },
        "export-pdf": {
          operation: "export/url",
          input: "convert-pdf",
          inline: false,
          archive_multiple_files: false,
        },
      },
    }),
  });
}

export async function createPdfImagesJob(params: {
  sourceUrl: string;
  fileName: string;
  candidateId: string;
}) {
  if (!/\.pdf$/i.test(params.fileName)) {
    throw new Error("PDF 페이지 이미지 변환에는 PDF 원본이 필요합니다.");
  }

  return cloudConvertRequest<CloudConvertJob>("/jobs", {
    method: "POST",
    body: JSON.stringify({
      tag: `woolim-portfolio-pdf:${params.candidateId}`,
      tasks: {
        "import-source": {
          operation: "import/url",
          url: params.sourceUrl,
          filename: params.fileName,
        },
        "convert-images": {
          operation: "convert",
          input: "import-source",
          input_format: "pdf",
          output_format: "png",
        },
        "export-images": {
          operation: "export/url",
          input: "convert-images",
          inline: false,
          archive_multiple_files: false,
        },
      },
    }),
  });
}

export function getCloudConvertJob(jobId: string) {
  return cloudConvertRequest<CloudConvertJob>(`/jobs/${encodeURIComponent(jobId)}`);
}

export function exportedFiles(job: CloudConvertJob, taskName: string) {
  const task = job.tasks.find((item) => item.name === taskName);
  return task?.result?.files || [];
}

export function exportedFile(job: CloudConvertJob) {
  return exportedFiles(job, "export-pdf")[0] || null;
}

export function cloudConvertFailure(job: CloudConvertJob) {
  const failedTasks = job.tasks.filter((task) => task.status === "error");
  const failedTask = failedTasks.find((task) => task.code !== "INPUT_TASK_FAILED")
    || failedTasks[0];
  const message = failedTask?.message || job.message || "문서 변환에 실패했습니다.";
  return failedTask?.code ? `${failedTask.code}: ${message}` : message;
}
