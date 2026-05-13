import youtubedl from 'youtube-dl-exec';

async function run() {
  try {
    const url = "https://www.youtube.com/watch?v=JNyuX1zoOgU";
    console.log("trying to fetch...");
    const output = await youtubedl(url, {
      dumpJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: [
        'referer:youtube.com',
        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.75 Safari/537.36'
      ]
    });
    console.log("Success:", output.title);
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}
run();
