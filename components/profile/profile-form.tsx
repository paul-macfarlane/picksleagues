"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { updateProfileAction } from "@/actions/profiles";
import {
  updateProfileSchema,
  type UpdateProfileInput,
} from "@/lib/validators/profiles";
import { getInitials } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type ProfileFormMode = "setup" | "edit";

type ProfileFormProps = {
  mode: ProfileFormMode;
  defaultValues: UpdateProfileInput;
};

export function ProfileForm({ mode, defaultValues }: ProfileFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues,
    mode: "onBlur",
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
    control,
  } = form;

  const watchedName = useWatch({ control, name: "name" });
  const watchedAvatarUrl = useWatch({ control, name: "avatarUrl" })?.trim();
  const previewSrc =
    watchedAvatarUrl && isLikelyHttpUrl(watchedAvatarUrl)
      ? watchedAvatarUrl
      : undefined;

  function onSubmit(values: UpdateProfileInput) {
    startTransition(async () => {
      const result = await updateProfileAction(values, {
        markSetupComplete: mode === "setup",
      });
      if (!result.success) {
        if (/username/i.test(result.error)) {
          setError("username", { message: result.error });
        }
        toast.error(result.error);
        return;
      }

      if (mode === "setup") {
        router.replace("/");
        router.refresh();
        return;
      }

      toast.success("Profile updated.");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-6"
      noValidate
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="username">Username</FieldLabel>
          <Input
            id="username"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            {...register("username")}
            aria-invalid={errors.username ? true : undefined}
          />
          <FieldDescription>
            3–50 characters. Letters, numbers, underscores, and hyphens.
          </FieldDescription>
          <FieldError errors={[errors.username]} />
        </Field>

        <Field>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <Input
            id="name"
            autoComplete="name"
            {...register("name")}
            aria-invalid={errors.name ? true : undefined}
          />
          <FieldError errors={[errors.name]} />
        </Field>

        <Field>
          <FieldLabel htmlFor="avatarUrl">Avatar URL</FieldLabel>
          <div className="flex items-center gap-3">
            <Avatar key={previewSrc ?? "no-src"} size="lg" aria-hidden>
              {previewSrc ? <AvatarImage src={previewSrc} alt="" /> : null}
              <AvatarFallback>{getInitials(watchedName ?? "")}</AvatarFallback>
            </Avatar>
            <Input
              id="avatarUrl"
              type="url"
              inputMode="url"
              placeholder="https://…"
              autoComplete="off"
              {...register("avatarUrl")}
              aria-invalid={errors.avatarUrl ? true : undefined}
            />
          </div>
          <FieldDescription>
            Optional. Paste a link to an image to preview it.
          </FieldDescription>
          <FieldError errors={[errors.avatarUrl]} />
        </Field>
      </FieldGroup>

      <Button type="submit" size="lg" disabled={isPending} className="w-full">
        {isPending
          ? "Saving…"
          : mode === "setup"
            ? "Complete setup"
            : "Save changes"}
      </Button>
    </form>
  );
}

function isLikelyHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
