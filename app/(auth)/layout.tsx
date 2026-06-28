/** Full-screen, centered layout for unauthenticated pages (no app shell). */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background flex min-h-dvh items-center justify-center p-6">
      {children}
    </div>
  );
}
