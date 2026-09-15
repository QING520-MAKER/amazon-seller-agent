// Child-process CLI tests run with this fetch replacement; no HTTP leaves the process.
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.origin !== "https://completion.amazon.com" || url.pathname !== "/api/2017/suggestions") {
    throw new Error(`Unexpected test HTTP request: ${url.origin}${url.pathname}`);
  }
  return new Response(JSON.stringify({
    suggestions: [
      { value: "portable blender" },
      { value: "portable blender for travel" },
      { value: "personal blender" },
      { value: "smoothie maker" },
      { value: "USB rechargeable blender" },
      { value: "portable blender extra cup" },
    ],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};
