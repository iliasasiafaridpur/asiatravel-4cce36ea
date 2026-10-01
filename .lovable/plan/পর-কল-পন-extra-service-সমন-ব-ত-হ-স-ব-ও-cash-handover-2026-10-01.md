# পরিকল্পনা — Extra Service সমন্বিত হিসাব ও Cash Handover

শুধু Extra Service–সংশ্লিষ্ট প্রদর্শন, পেমেন্ট, Accounts, Cash Handover এবং নির্বাচিত Cash Handover প্রিন্টের watermark অংশে কাজ হবে। কোনো পুরোনো ব্যবসার ডাটা, হিসাবের নিয়ম, status, agency/vendor ledger বা অন্য page পরিবর্তন করা হবে না।

## ১) Module page: এক মোট Due ও এক payment action

- মূল সার্ভিসের বিল, received ও discount-এর সঙ্গে যুক্ত সব Extra Service-এর bill, received ও discount যোগ করে একটিমাত্র **মোট Due** দেখাব।
- বর্তমানে আলাদা `Due` ও `Extra Due` action আছে; এগুলোর বদলে একটিমাত্র মোট Due amount/payment action থাকবে।
- ক্লিক করলে একই payment window-তে মূল সার্ভিস ও প্রতিটি Extra Service-এর নাম, নিজস্ব বাকি এবং payment/discount input দেখা যাবে।
- নির্বাচিত সিদ্ধান্ত অনুযায়ী user নিজে প্রতিটি অংশে কত টাকা/discount যাবে তা লিখবেন। কোনো অংশের due-এর বেশি স্বয়ংক্রিয়ভাবে বসবে না।
- Save করার সময় মূল সার্ভিস ও Extra Service-এর বর্তমান accounting paths, receipt records, payment method, vendor-received handling এবং delivery option অক্ষুণ্ণ থাকবে। একই save-এর receipt rows-এ একটি shared batch identity থাকবে, যাতে পরের page-গুলো এটিকে একই transaction হিসেবে বুঝতে পারে।
- Extra Service discount বাদ পড়ে due বেশি দেখানোর bug এবং parent edit করলে Extra Service discount নষ্ট হওয়ার ঝুঁকি ঠিক করব।

## ২) Passenger Profile

- “এই যাত্রীর সকল সার্ভিস” তালিকায় প্রতিটি parent module-এর সঙ্গে তার Extra Service নামগুলো `+ Extra Service — [নাম]` আকারে দেখাব।
- Financial Ledger-এ Extra Service-কে আলাদা অস্পষ্ট total না রেখে যে module/ID-এর সঙ্গে যুক্ত, সেই লাইনের নিচে নামসহ দেখাব।
- Total Bill, Total Received ও Outstanding Due-তে Extra Service একবারই যোগ হবে; duplicate বা double count হবে না।
- Extra Services বিস্তারিত অংশ আগের মতো থাকবে, তবে parent module/ID পরিষ্কারভাবে বোঝা যাবে।

## ৩) Accounts page

- মূল module receipt এবং Extra Service receipt—দুটিতেই module-এর নামের সঙ্গে Extra Service-এর নাম দেখাব।
- একই unified payment save-এর main + extra receiptগুলো Accounts screen ও print-এ এক transaction হিসেবে group হবে; method breakdown ও cash balance আগের নিয়মেই থাকবে।

## ৪) Cash Handover screen ও print

- Parent service-এর সঙ্গে যুক্ত Extra Service data preload করে প্রতিটি প্রাসঙ্গিক row-তে:
  - **মোট বিল** = মূল বিল + Extra Service bill
  - **বাকি** = মূল ও Extra Service-এর বর্তমান মোট বাকি
  - **সার্ভিস** = মূল service `+` Extra Service নামগুলো
- একই unified payment-এর main + extra receiptগুলো এক row-তে group হবে; Cash/MD/Vendor method breakdown অপরিবর্তিত থাকবে।
- Screen ও single/multiple print একই হিসাব ও label ব্যবহার করবে।
- Total-mode agency aggregation-এর বিদ্যমান নিয়ম অপরিবর্তিত থাকবে; Extra Service double count না হয় তা আলাদাভাবে guard করব।

## ৫) Watermark ও সীমিত bug fixes

- নির্বাচিত Cash Handover print-এর logo watermark opacity সামান্য বাড়াব, যাতে সাধারণ printer-এ পরিষ্কার বোঝা যায় কিন্তু লেখার পাঠযোগ্যতা নষ্ট না হয়। Watermark off থাকলে আগের মতো কোনো watermark থাকবে না।
- শুধু অনুরোধকৃত flow-তে পাওয়া concrete bug ঠিক করব: Extra discount due calculation, discount preservation, parent/extra grouping এবং duplicated totals। সম্পর্কহীন code বা business logic পরিবর্তন করব না।

## যাচাই

- মূল due only, extra due only, দুটো due, extra discount, multiple extras এবং multiple payment methods—প্রতিটি case যাচাই করব।
- Module list, Passenger Profile, Accounts screen/print এবং Cash Handover screen/single print/multiple print-এ একই total ও service names মিলিয়ে দেখব।
- Desktop ও mobile-এ payment window ব্যবহারযোগ্য এবং বর্তমান layout অক্ষুণ্ণ আছে কিনা যাচাই করব।
- Typecheck ও সংশ্লিষ্ট runtime flow পরীক্ষা করব; কোনো business data create/delete করে test করব না।
