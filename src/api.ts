import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import axiosRetry from "axios-retry";
import { Socket } from "phoenix";
import { AxiosError } from "axios";

type ApiClientOptions = {
  host: string;
  apiKey: string;
  userToken: string | undefined;
};

export interface ApiResponse {
  error?: any;
  body?: any;
  statusCode: "ok" | "error";
  status: number;
}

class ApiClient {
  private host: string;
  private apiKey: string;
  private userToken: string | null;
  private axiosClient: AxiosInstance;
  private socket: Socket;
  public socketConnected: boolean = false;

  constructor(options: ApiClientOptions) {
    this.host = options.host;
    this.apiKey = options.apiKey;
    this.userToken = options.userToken || null;

    // Create a retryable axios client
    this.axiosClient = axios.create({
      baseURL: this.host,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "X-Knock-User-Token": this.userToken,
      },
    });

    this.socket = new Socket(`${this.host.replace("http", "ws")}/ws/v1`, {
      params: {
        user_token: this.userToken,
        api_key: this.apiKey,
      },
    });

    axiosRetry(this.axiosClient, {
      retries: 3,
      retryCondition: this.canRetryRequest,
      retryDelay: axiosRetry.exponentialDelay,
    });
  }

  connectSocket() {
    if (this.socketConnected) {
      return;
    }

    this.socket.connect();
    this.socket.onOpen(() => {
      this.socketConnected = true;
    });
  }

  disconnectSocket() {
    this.socket.disconnect();
    return;
  }

  createChannel(name: string, params?: object) {
    return this.socket.channel(name, params);
  }

  async makeRequest(req: AxiosRequestConfig): Promise<ApiResponse> {
    try {
      const result = await this.axiosClient(req);

      return {
        statusCode: result.status < 300 ? "ok" : "error",
        body: result.data,
        error: undefined,
        status: result.status,
      };
    } catch (e) {
      // tslint:disable-next-line
      console.error(e);

      return {
        statusCode: "error",
        status: 500,
        body: undefined,
        error: e,
      };
    }
  }

  private canRetryRequest(error: AxiosError) {
    // Retry Network Errors.
    if (axiosRetry.isNetworkError(error)) {
      return true;
    }

    if (!error.response) {
      // Cannot determine if the request can be retried
      return false;
    }

    // Retry Server Errors (5xx).
    if (error.response.status >= 500 && error.response.status <= 599) {
      return true;
    }

    // Retry if rate limited.
    if (error.response.status === 429) {
      return true;
    }

    return false;
  }
}

export default ApiClient;
