# Epic 2 Feedback

## First Round

### Critical: middleware bug (addressed)

Right now after signing in with google there is an infinite redirect, presumably because of the middleware. Mike personal take is that we don't need middleware at all. We can just check for the user's auth on each page and redirect accordingly.

### Branding (addressed)

We should use Google and Discord Icons in the Oauth sign in buttons to match their branding guidelines and also to make the apps feel more official in general

### Unauthed Experience (addressed)

In addition to just having a login page, I'd like to have a splash page for the app that makes potential users excigted and informed about using the app. We should make a note that the app is currently a WIP/in beta.

I would also like unauthed users be able to toggle light/dark/system mode. There is an example implementation for NextJS here: https://ui.shadcn.com/docs/dark-mode/next.

### T&C and Privacy Policy (addressed)

Google and Discord will require us to link to our terms and condiditons and privacy policy. Help me generate those and add those pages into a place where unauthed and authed users can view and are navigatable to. Use the BUSINESS_SPEC to assist in generating these. Don't make stuff up, and keep both simple.

### Generating and running migrations (addressed)

When updating the database schema, you should use `npx drizzle-kit generate` to generate a new schema and `npx drizzle-kit migrate` to apply that schema change. Let's make sure to account for that in future development work and add this to the appropraite place in our docs so its in your long term memory and not just for this session.

## Second Round (addressed)

### Setting up profile

The avatar url should have a preview in its avatar format so a user can verify they want to use the url. Use https://ui.shadcn.com/docs/components/radix/avatar as a preview since that is realistically what we'd be using for the actual avatar in the app anyways.

### Way to sign out

There needs to be a way for users to sign out. We should implement that.

### Navigation and header for Authed Users

Let's try to be forward thinking and set up navigation for authed users. There really shouldn't be too many places to navigate to begin with because the app is pretty small in scope, but we should still set something up. Feel free to ask clariciying questions on how this would work. I'd at least expect

- A home page that has the user's leagues, will show any pending invites, and also gives the user the ability to edit their league
- A profile avatar in a top section that when clicked opens a menu for managing profile, account. There also should be a way to toggle light/dark/system mode.

Feel free to push back on any of these and suggest changes as an ui/ux expert.

We also need to make sure we handle mobile screen sizes.

### 3rd Round of Feedback (addressed)

The profile page is missing the same layout and header/navbar that the others have

Content on the profile and account pages should start at the top for consistency with the rest of the app

### 4th Round of Feedback (addressed)

We should center the content for the profile and account page in the page to make things consistent with the rest of the app.

### 5th round of Feedback (addressed)

I see in the home page (src/app/(public)/home/page.tsx) there are comments that indicate the section of page. Normally for humans, we tend to like comments only explaining WHY, not WHAT. I do kinda see why the comments are there to break it up, but I think in that instance, we can break up into components with good names, instead of comments. This logic applies to big functions too. Once you feel you have to start commenting to break down the different sections, you probably want to make smaller private functions. These don't need to be tested on their own, but would be tests as part of the larger exported function. Let's incorperate this into our coding/architecture standards, and make the adjustments where relevant to this pull request.

In addition to comments about delinaeting code, we should avoid comments about WHAT code does and only focus on WHY it is there IF an explanation is needed. Make sure this is incorperated into our standards and also incorperated into the changes for this pull request.

In src/actions/action.ts, there are several queries in deleteAccount that should be abstracted to the database layer, lets fix that. I believe our architectural standards require that too, but if not, let's make sure that state that.

The login page should have the same redirect logic as the splash page where it handles the edge case of if a user needs to setup their profile. Let's create unified function for authed redidirects on unauthed pages to ensure we have consistent handling, and then use it in both places. Or we could just have a layout for the unauthed pages and we don't need the function.

There should be a way to view the terms of service and privacy policy even as an authed user. I think we should have links for those on the account page somewhere (use your ui/ux experise to determine where). For authed users, the header for these pages would still show and the back button would go back to the account instead of splahs pages.

One thing I noticed is that our db functions don't have types defined for their return types, but they should. We can infer types using drizzles infer type system and then type the returns accordingly. Let's make sure return types for functions (with the exception of UI components) is a standard we document, use in this PR, and use going forward.

We DON'T need to write tests for validators. No need to test something Zod already does. Let's make sure to document this as part of our standards, update this PR, and make sure we do this in future sessions.

### 6th round

Do we need the auth and redirect check for the splash page if the layout already handles it? Or does the layout actually not cover that?

Let's add a linter/formatter for sorting imports so that we have consistent import sorting.

For hyperlinks that are not buttons, we should have underlines to make it clear that they are links, since mobile users won't have the ability to hover over those.

The vertical distance from the navbar to the TOS and Privacy policy is inconsistent with the rest of the auth pages, we should fix that.

Because multiple places may be using the same database table and types for queries, I think we should put the inferred types for those tables IN the schema files to avoid circular imports.
