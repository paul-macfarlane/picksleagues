"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { updateProfile } from "@/actions/profiles";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  UpdateProfileSchema,
  type UpdateProfileInput,
} from "@/lib/validators/profiles";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface ProfileFormProps {
  defaultValues: {
    username: string;
    name: string;
    avatarUrl: string;
  };
  isSetup: boolean;
}

export function ProfileForm({ defaultValues, isSetup }: ProfileFormProps) {
  const router = useRouter();

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(UpdateProfileSchema),
    defaultValues: {
      ...defaultValues,
      isSetup,
    },
  });

  const watchedName = useWatch({ control: form.control, name: "name" });

  async function onSubmit(data: UpdateProfileInput) {
    const result = await updateProfile(data);
    if (!result.success) {
      toast.error(result.error);
      return;
    }

    toast.success(isSetup ? "Profile created!" : "Profile updated!");
    if (isSetup) {
      router.push("/");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder="your-username" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display Name</FormLabel>
              <FormControl>
                <Input placeholder="Your Name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="avatarUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Avatar URL</FormLabel>
              <div className="flex items-center gap-3">
                <Avatar size="lg">
                  {field.value ? (
                    <AvatarImage src={field.value} alt="Avatar preview" />
                  ) : null}
                  <AvatarFallback>{getInitials(watchedName)}</AvatarFallback>
                </Avatar>
                <FormControl>
                  <Input
                    placeholder="https://example.com/avatar.png"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          className="w-full"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting
            ? "Saving..."
            : isSetup
              ? "Complete Setup"
              : "Save Changes"}
        </Button>
      </form>
    </Form>
  );
}
