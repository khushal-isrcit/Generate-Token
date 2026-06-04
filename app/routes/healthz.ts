export const loader = async () => {
  return Response.json({
    ok: true,
    service: "Easy Api Token",
    timestamp: new Date().toISOString(),
  });
};
