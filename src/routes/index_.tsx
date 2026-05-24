import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/index_")({
  component: () => <Navigate to="/" replace />,
});