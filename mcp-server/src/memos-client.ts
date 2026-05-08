interface MemoProperty {
  hasLink: boolean;
  hasTaskList: boolean;
  hasCode: boolean;
  hasIncompleteTasks: boolean;
}

interface MemoLocation {
  placeholder: string;
  latitude: number;
  longitude: number;
}

interface Memo {
  name: string;
  state: string;
  creator: string;
  createTime: string;
  updateTime: string;
  displayTime: string;
  content: string;
  visibility: string;
  tags: string[];
  pinned: boolean;
  property: MemoProperty;
  snippet: string;
  location: MemoLocation | null;
}

interface ListMemosResponse {
  memos: Memo[];
  nextPageToken: string;
}

export class MemosClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private async request(path: string, options: RequestInit = {}): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Memos API error ${response.status}: ${body.slice(0, 500)}`);
    }

    return response.json();
  }

  async listMemos(params: {
    pageSize?: number;
    pageToken?: string;
    state?: string;
    orderBy?: string;
    filter?: string;
  } = {}): Promise<ListMemosResponse> {
    const searchParams = new URLSearchParams();
    if (params.pageSize) searchParams.set("pageSize", String(params.pageSize));
    if (params.pageToken) searchParams.set("pageToken", params.pageToken);
    if (params.state) searchParams.set("state", params.state);
    if (params.orderBy) searchParams.set("orderBy", params.orderBy);
    if (params.filter) searchParams.set("filter", params.filter);

    const query = searchParams.toString();
    return this.request(`/api/v1/memos${query ? `?${query}` : ""}`) as Promise<ListMemosResponse>;
  }

  async getMemo(id: string): Promise<Memo> {
    return this.request(`/api/v1/memos/${encodeURIComponent(id)}`) as Promise<Memo>;
  }

  async createMemo(params: {
    content: string;
    visibility?: string;
    pinned?: boolean;
    displayTime?: string;
    memoId?: string;
  }): Promise<Memo> {
    const body: Record<string, unknown> = {
      content: params.content,
      visibility: params.visibility || "PRIVATE",
      pinned: params.pinned ?? false,
    };

    const query = params.memoId ? `?memoId=${encodeURIComponent(params.memoId)}` : "";
    const created = (await this.request(`/api/v1/memos${query}`, {
      method: "POST",
      body: JSON.stringify(body),
    })) as Memo;

    // Memos ignores displayTime in POST and stores zero-epoch (shows as 1970)
    // unless we PATCH it afterwards. Always set it to the user-specified value
    // or "now" as a sensible default.
    const id = created.name.replace(/^memos\//, "");
    return this.updateMemo(id, {
      displayTime: params.displayTime ?? new Date().toISOString(),
    });
  }

  async updateMemo(id: string, params: {
    content?: string;
    visibility?: string;
    pinned?: boolean;
    state?: string;
    displayTime?: string;
  }): Promise<Memo> {
    const body: Record<string, unknown> = {};
    const updateFields: string[] = [];

    if (params.content !== undefined) {
      body.content = params.content;
      updateFields.push("content");
    }
    if (params.visibility !== undefined) {
      body.visibility = params.visibility;
      updateFields.push("visibility");
    }
    if (params.pinned !== undefined) {
      body.pinned = params.pinned;
      updateFields.push("pinned");
    }
    if (params.state !== undefined) {
      body.state = params.state;
      updateFields.push("state");
    }
    if (params.displayTime !== undefined) {
      body.displayTime = params.displayTime;
      // Memos server checks update_mask paths in snake_case; camelCase is
      // silently ignored. JSON body keeps proto3-default camelCase.
      updateFields.push("display_time");
    }

    const updateMask = updateFields.join(",");
    const query = updateMask ? `?updateMask=${encodeURIComponent(updateMask)}` : "";

    return this.request(`/api/v1/memos/${encodeURIComponent(id)}${query}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as Promise<Memo>;
  }

  async deleteMemo(id: string): Promise<void> {
    await this.request(`/api/v1/memos/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
}
