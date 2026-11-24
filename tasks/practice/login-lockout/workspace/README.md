# Login lockout

The service locks an account after **five failed sign-ins**. A locked account
refuses every further attempt, even one with the right password, until an
administrator clears it.

A security review found that the limit can be dodged. On the sign-in page,
someone got ten password guesses at one account by alternating between `alice`
and `Alice`. Each spelling was counted separately.

The rule the service is meant to follow:

- A username identifies one account however it is typed. Letter case does not
  matter, and neither do spaces before or after it. `alice`, `Alice` and
  `" alice "` are the same account.
- Failed attempts are counted **per account**, not per spelling.
- The rule applies to every way of signing in. There are two: the sign-in page
  (`auth/web_login.py`) and the API (`auth/api_login.py`). They share one
  attempt log, so failures on one count on the other.
- A successful sign-in clears the account's failed attempts.

Repair the lockout so it follows that rule. Keep the limit of five, the function
signatures and the values each function returns.

Run the public checks as you work. They cover ordinary sign-ins; the submission
checks exercise the cases from the review. All accounts here are made up.
