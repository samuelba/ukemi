export declare const ASSET_PATTERNS: Record<string, RegExp>
export declare const REQUIRED_ASSETS: string[]
export declare function pickAssets(
  releaseAssets: readonly { name: string; browser_download_url: string }[],
): { assets: Record<string, string>; missing: string[] }
