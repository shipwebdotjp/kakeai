export class TtsEngineUnavailableError extends Error {
  constructor(message = "音声エンジンに接続できません。") {
    super(message);
    this.name = "TtsEngineUnavailableError";
  }
}

export class TtsInputRejectedError extends Error {
  constructor(message = "音声エンジンが入力を拒否しました。") {
    super(message);
    this.name = "TtsInputRejectedError";
  }
}
