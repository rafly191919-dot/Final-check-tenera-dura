
Dura Tenera Realtime Fixed

Perbaikan utama:
- Listener realtime sekarang memakai onSnapshot(collection(db, "transactions"))
- Tidak lagi memakai query where + orderBy yang rawan butuh composite index
- Filter harian/mingguan/bulanan dilakukan di frontend setelah data realtime diterima
- Sequence ID harian dihitung dari cache realtime, bukan query kombinasi Firestore

Agar benar-benar jalan:
1. Firebase Authentication Email/Password aktif
2. User tersedia:
   - grading@dura.local
   - staff@dura.local
3. Firestore rules mengizinkan user login membaca/menulis collection transactions
4. Deploy domain sudah ditambahkan di Authorized Domains Firebase Auth bila perlu
