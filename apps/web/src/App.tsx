import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import { createQueryClient } from "./query.js";
import { createAppRouter } from "./router.js";

export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createAppRouter({ queryClient }));

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
