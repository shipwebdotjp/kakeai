export type LivePackageErrorCode =
  | "not_found"
  | "not_a_directory"
  | "invalid_manifest"
  | "invalid_json"
  | "unsafe_path"
  | "symlink"
  | "missing_file"
  | "extra_file"
  | "size_mismatch"
  | "hash_mismatch"
  | "media_type_mismatch"
  | "material_audio"
  | "required_font_missing"
  | "reference_missing"
  | "invalid_package";

export class LivePackageError extends Error {
  readonly code: LivePackageErrorCode;
  readonly path: string | undefined;

  constructor(code: LivePackageErrorCode, message: string, path?: string) {
    super(message);
    this.name = "LivePackageError";
    this.code = code;
    this.path = path;
  }
}

export function packageError(
  code: LivePackageErrorCode,
  message: string,
  path?: string,
): LivePackageError {
  return new LivePackageError(code, message, path);
}

export function isPackageError(error: unknown): error is LivePackageError {
  return error instanceof LivePackageError;
}
