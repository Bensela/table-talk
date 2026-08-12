Table Talk (aka Catalyst)
Product Thoughts to Share and Discuss, Aug 3, 2026

Priority 1 Items
1. Testing: I want to get QR codes into couples hands here for feedback this
week. Any concerns with that?
Question: Can we setup a Test Restaurant to try that too and then put their QR code under it?
2. Dashboard: I would request a walkthrough of the dashboard. (Thank you
for the work on it!_
3. Question List: I need to know how to update the question list. I note that
it seems possible via the dashboard.

Priority 2 Items (in approximate order)
4. Are we or can we log every step of every session, with a timestamp?
Every step a session takes gets logged, timestamped, and carries the restaurant, table, and session
identity. Every step, not just the notable ones — the scan itself, the welcome screen, each selection,
each question shown and advanced, the ending and how it ended.
Why: We need to know where people disengage and how long they spend at each point. A scan that
stops at the welcome screen and a scan that stops after selecting a mode have completely different
fixes, and are indistinguishable unless both steps are logged. Sessions that never start are invisible
unless the scan is logged on its own.
This is not a new convention. The Backend Platform Standard already requires an ISO-8601 timestamp
on every log entry. This is that pattern applied consistently to session events.
Nearly everything else we want falls out of this. Connections per table per day, funnel drop-off, time of
day and day of week patterns, whether a second phone ever joined a Dual-Phone session, and
concurrent sessions on one table are all queries over this data rather than separate features.
a. We need to store raw events, never summaries.
I will be defining the monthly report later. That is only possible raw events with timestamps can be
recomputed into any metric at any time.
• Events are append-only. Never overwritten.
• If report queries get slow, add rollup tables alongside the raw events — never instead of them.

• Retention: keep everything for now. Volume is small … single-digit millions of rows a year at a
hundred restaurants … so there is no cost argument for deleting. Revisit in about six months
once sales are running.
No third-party analytics tools. An external analytics service puts the data somewhere we do not
own, fragments it across systems, and typically collects device and IP-level information that conflicts
with our no-PII position. This data is the asset. It stays in our own database.

5. Can we support multiple sessions on one table?
More than one session must be able to run on the same table token at the same time. We discussed this
before. I just can’t recall how that ended up.
One known cause: A guest can photograph the QR code and use it later from home. Not preventable,
and not worth preventing - heavy off-site use would be a demand signal for a take-home product.
It seems by the dashboard that we may be able to detect this occurring by GPS info not near or at the
restaurants?
6. Website Stuff
a. Transfer of the Webapp and Dashboard to my site…
MadeToConnectCo.com
I think before we get this to restaurants we want to get the app working from my website…
Let’s use the came “Catalyst” for this product.
so I am thinking the hosting URL appears something like… Catalyst.MadeToConnectCo.com
and CatalystDashboard.MadeToConnectCo.com
b. Creation of the website in general
I don’t even have a homepage for this site… I think I can produce it with AI quicker than
explaining what I need, but could use some minimal help getting code loaded.
7. Feedback on which questions resonate could be very valuable.
Thought: Could we add an optional feedback opportunity on each question? … something like …
&quot;Like the question? Yes / No&quot;
… I want to jointly think through this because it might hurt the UI.
… otherwise we will be trying to determine the value of the question from timestamps between
questions which we will do, but that data will be messier. This is give us more distinct feedback when
people choose to exercise that option to provide it.
Why question-level performance matters more than it looks: It is the value we leverage into the next
product.

8. Asking people to rate the state of their relationship could be awkward.
Thought: I think we should replace the Exploring / Established selection with a factual question — how
long have you been together — using four options:

Guest sees Question stage in the content model
Under 6 months Exploring
6 months - 2 years Exploring
2 - 10 years Established
10+ years Established
This split is arbitrary and that is fine. The point of collecting four is that we learn who is using the
product, and can split the content differently later if the data justifies it.
8. Can we add … one recommendation question, mid-session?
I would like to get some feedback on the product if possible. What if we add a question … &quot;How likely
are you to recommend this to a friend?&quot; 0 to 10.
This measures transferable demand for a product the guest cannot yet buy. It is useful from the first
session, with no benchmark needed.
• Scale is 0 to 10 — eleven points, zero through ten. Not 1-10, not 0-11.
• The trigger point is a setting, not a fixed number. Five questions in is one proposed approach; if the
data says seven works better we want to move it without a release.
• Store the raw value with a timestamp. Compute scores later.
Known bias, accepted: Anyone answering at question five reached question five, so the score will run
high. Fine as a directional number, not a read on all guests.

Priority 3 Items – Operational Thoughts
9. Data export
Looks like the dashboard will give me some highlevel info and the ability to export the raw data for
evaluation. That is awesome. I just need to confirm what ability exists in the walkthrough.

10. Table numbers and QR codes
Tables are set up per restaurant, one entry per table, for the number of tables we specify for that
restaurant. I foresee the process as follows:
1. I project the Restaurant Name and the number of tables
2. You or an automation of the task then gives me back a list of URLs, each paired with its table
number. A simple list — Table 1 and its URL, Table 2 and its URL, and so on.
3. I will rendering those URLs into QR images and produce the printed displays.
That number must appear in two places:
• In the data, so a session can be seen as belonging to Table 7 at a given restaurant
• Discreetly on the printed table display, so the physical position can be matched back to the data