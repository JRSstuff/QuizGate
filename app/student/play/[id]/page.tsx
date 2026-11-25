import { AppShell } from "@/components/AppShell";
import { QuizRunner } from "@/components/QuizRunner";

export default async function PlayQuizPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <QuizRunner targetId={id} />
    </AppShell>
  );
}
