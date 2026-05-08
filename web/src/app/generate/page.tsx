import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GenerateForm } from "@/components/generate/GenerateForm";

export default function GeneratePage() {
  return (
    <DashboardLayout title="Generate Content">
      <div className="max-w-2xl">
        <p className="text-gray-500 text-sm mb-6">
          Describe your campaign goal and the AI agent will generate brand-aligned content variants,
          run compliance checks, and place them in the approval queue.
        </p>
        <GenerateForm />
      </div>
    </DashboardLayout>
  );
}
