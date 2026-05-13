## পরিকল্পনা — AIR TICKET কলাম সিরিয়াল BMET এর মত করা

### বর্তমান অবস্থা

**BMET CARD** এর list কলাম সিরিয়াল:
```
Date → Passenger → Passport → Mobile → Country → Attested Date →
Agency → Vendor → Vendor Sent Date → Received Date →
Status → Delivery Date → Price → Cost Price → Received → Due → Profit → Notes → Entry By
```

**AIR TICKET** এর বর্তমান সিরিয়াল (Cost Price কলাম **নেই**):
```
Date → Passenger → Passport → Airline → Trip Road → Flight Date →
Agency → Price → Received → Due → Profit
```

### প্রস্তাবিত পরিবর্তন

AIR TICKET এর `listOrder` BMET এর সাথে মিলিয়ে নতুন সিরিয়াল হবে (Ticket এ যেসব কলাম common সেগুলোর positon BMET এর মতই):

```
entry_date         → Date
passenger_name     → Passenger Name
passport           → Passport
mobile             → Mobile           (নতুন list এ যোগ)
airline            → Airline           (BMET এর Country এর জায়গায়)
trip_road          → Trip Road
flight_date        → Flight Date       (BMET এর Attested Date এর জায়গায়)
agency_sold        → Agency
vendor_bought      → Vendor            (নতুন list এ যোগ)
status             → Status            (নতুন list এ যোগ)
sold_price         → Price
cost_price         → Cost Price        ⭐ নতুন কলাম যোগ
received           → Received Amount
due                → Due
profit             → Profit
notes              → Notes             (নতুন list এ যোগ)
entry_by           → Entry By          (নতুন list এ যোগ)
```

পরিবর্তন হবে শুধু `src/lib/modules.ts` এর `tickets` module এর `fields` (showInList যোগ + cost_price এর showInList true) এবং `listOrder` array।

---

### বাংলায় কয়েকটা প্রশ্ন আছে — আপনার মতামত দরকার

আগে confirm করে নেই তারপর কাজ করব।