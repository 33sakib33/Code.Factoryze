# Duplicate customers

`crm/export.py` prepares the customer list that goes to the mailing tool. Each
customer should appear once.

Support has noticed that some people appear twice in the export. In every case
found so far, the two records have the same email address written with
different letter case, for example `Ana.Silva@example.com` and
`ana.silva@example.com`.

What the code looks like:

- `crm/records.py` defines `Customer`: an email, a name, whether the email is
  verified, and when the record was last updated.
- `crm/export.py` has `merge_duplicates`, which returns one record per customer,
  and `export_lines`, which formats the merged list.

The merged list keeps customers in the order they first appear in the input.
Keep the function signatures and the format of the exported lines.

Run the public checks as you work. All people and addresses here are made up.
