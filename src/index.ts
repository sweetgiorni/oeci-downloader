import axios from "axios";
import fetchAdapter from "./adapter";
import JSZip from "jszip";
import { saveAs } from "file-saver";
// import mime from "mime";
// const mimePromise = import("mime");
var mime: any = null;

axios.defaults.adapter = fetchAdapter;

const datePattern = /^(\d\d)\/(\d\d)\/(\d{4})/;
const dateReplacement = "$3_$1_$2";

var protectedPersonName: string | null = null;
var overallStatusDiv: HTMLDivElement | null = null;

interface Image {
  // The name of the event, e.g "12/12/2012 Report - Guardian".
  // Multiple images can be associated with the same event.
  event: string;
  // The image name as shown in the link, e.g. "Report - Guardian"
  // This is not unique, as multiple images in the same event can have the same name.
  imageName: string;
  // The URL of the image.
  url: string;
  // A reference to the row in the table where the image is located.
  // Used for download status indication.
  row: HTMLTableRowElement;
  // The blob of the image.
  blob?: Blob;
}
async function main() {
  mime = await import("mime");
  GM_addStyle(`
#loading {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(0, 0, 0, 0.27);
  border-radius: 50%;
  border-top-color: #fff;
  animation: spin 1s ease-in-out infinite;
  -webkit-animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to { -webkit-transform: rotate(360deg); }
}
@-webkit-keyframes spin {
  to { -webkit-transform: rotate(360deg); }
}
`);
  let btn = document.createElement("BUTTON");
  btn.onclick = gatherAndDownload;
  const inTheMatterOfDiv = document.querySelector("body > div:last-of-type");
  if (!inTheMatterOfDiv) {
    console.error("Couldn't find button container.");
    return;
  }
  // Extract the name from the matter of div with a regex
  const nameMatch = inTheMatterOfDiv.textContent?.match(
    /In the Matter of:\s+(.+)/
  );
  if (!nameMatch) {
    console.error("Couldn't find name in the matter of div.");
  } else {
    protectedPersonName = nameMatch[1];
    console.log(`Protected person name: ${protectedPersonName}`);
  }
  btn.innerText = "Download all files";
  btn.style.top = "8px";
  btn.style.right = "8px";
  btn.style.zIndex = "9999";
  btn.style.backgroundColor = "white";
  btn.style.border = "1px solid black";
  btn.style.padding = "5px";
  btn.style.marginLeft = "1rem";
  btn.style.cursor = "pointer";
  btn.style.fontSize = "16px";
  btn.style.fontWeight = "bold";
  btn.style.fontFamily = "Arial, sans-serif";
  btn.style.borderRadius = "5px";
  btn.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.3)";
  btn.style.transition = "background-color 0.3s ease";
  btn.onmouseover = () => {
    btn.style.backgroundColor = "#f0f0f0";
  };
  btn.onmouseout = () => {
    btn.style.backgroundColor = "white";
  };
  btn.onmousedown = () => {
    btn.style.transform = "scale(0.95)";
  };
  btn.onmouseup = () => {
    btn.style.transform = "scale(1)";
  };
  btn.onmouseleave = () => {
    btn.style.transform = "scale(1)";
  };
  btn.onfocus = () => {
    btn.style.outline = "none";
  };
  btn.onblur = () => {
    btn.style.outline = "none";
  };

  inTheMatterOfDiv.appendChild(btn);
  // Add the overall status loading spinner after the button
  overallStatusDiv = document.createElement("div");
  overallStatusDiv.id = "overallStatusDiv";
  overallStatusDiv.style.display = "inline-block";
  overallStatusDiv.style.marginLeft = "1rem";
  inTheMatterOfDiv.appendChild(overallStatusDiv);

}

function setOverallStatusDownloading() {
  if (!overallStatusDiv) return;
  // Delete any existing success or error divs
  const existingSuccessDiv = overallStatusDiv.querySelector("div");
  if (existingSuccessDiv) {
    existingSuccessDiv.remove();
  }
  // Add the loading spinner div
  const loadingDiv = document.createElement("div");
  loadingDiv.id = "loading";
  overallStatusDiv.appendChild(loadingDiv);
}

function setOverallStatusSuccess() {
  if (!overallStatusDiv) return;
  // Remove the loading spinner
  const loadingDiv = overallStatusDiv.querySelector("#loading");
  if (loadingDiv) {
    loadingDiv.remove();
  }
  // Add a success checkmark span
  const successDiv = document.createElement("div");
  successDiv.innerHTML = "<span style='color: green;'>✔</span>";
  successDiv.style.display = "inline-block";
  overallStatusDiv.appendChild(successDiv);
}

function setRowStatusDownloading(row: HTMLTableRowElement) {
  // If there are only three tds, add a new one to the end
  // to show the loading spinner.
  const tds = row.getElementsByTagName("td");
  if (tds.length == 4) {
    row.removeChild(tds[3]);
  }
  if (tds.length == 3) {
    const newTd = document.createElement("td");
    newTd.innerHTML = "<div id='loading'></div>";
    row.appendChild(newTd);
  } else {
    console.error(`Row has ${tds.length} tds, expected 3 or 4.`);
  }
}

function setRowStatusSuccess(row: HTMLTableRowElement) {
  const tds = row.getElementsByTagName("td");
  if (tds.length == 4) {
    const loadingDiv = tds[3].getElementsByTagName("div")[0];
    if (loadingDiv) {
      loadingDiv.style.display = "none";
    }
    const successDiv = document.createElement("div");
    successDiv.innerHTML = "<span style='color: green;'>✔</span>";
    tds[3].appendChild(successDiv);
  } else {
    console.error(`Row has ${tds.length} tds, expected 4.`);
  }
}

function setRowStatusError(row: HTMLTableRowElement) {
  const tds = row.getElementsByTagName("td");
  if (tds.length == 4) {
    const loadingDiv = tds[3].getElementsByTagName("div")[0];
    if (loadingDiv) {
      loadingDiv.style.display = "none";
    }
    const errorDiv = document.createElement("div");
    errorDiv.innerHTML = "<span style='color: red;'>✘</span>";
    tds[3].appendChild(errorDiv);
  } else {
    console.error(`Row has ${tds.length} tds, expected 4.`);
  }
}

async function downloadImage(image: Image) {
  const result = await axios.get<Blob>(image.url, {
    responseType: "blob",
  });
  console.log(result);
  if (result.status !== 200) {
    throw new Error(`GET request returned status ${result.status}`);
  }
  image.blob = result.data;
  return;

  // // TEST ERROR INJECTION

  // // Simulate a 10% chance of error
  // const errorChance = Math.random();
  // if (errorChance < 0.1) {
  //   throw new Error("Simulated error during download.");
  // }
  // // END TEST ERROR INJECTION
  // const sleep = (time: number) =>
  //   new Promise((resolve) => setTimeout(resolve, Math.ceil(time * 1000)));
  // var delay = Math.floor(Math.random() * 4) + 2;
  // await sleep(delay);
  // image.blob = new Blob(["blahb"], { type: "image/jpeg" });
}

async function gatherAndDownload() {
  setOverallStatusDownloading();
  // console.log("Downloading files...");
  // const mime = await mimePromise;
  // console.log(`Status: ${result.status}`);
  // console.log(`Content Length: ${result.data.length}`);
  const eventToImages: Record<string, Array<Image>> = {};

  const caseNoSpan = document.querySelector("div > span");
  if (!caseNoSpan) {
    throw "Couldn't find case number span.";
  }
  const caseNo = caseNoSpan.textContent ?? "UnknownCaseNumber";
  var lastEventName = "";
  jQuery("table")
    .eq(4)
    .find("tr")
    .each((i, v) => {
      if (i == 0) return;
      const tds = jQuery(v).find("td");
      if (!tds || tds.length == 0) {
        console.log(`tds is empty???`);
        console.log(`i: ${i}, v: ${v}`);
      }
      const event = tds[0].innerText;
      if (event) {
        lastEventName = event.replace(datePattern, dateReplacement);
      }
      if (!lastEventName) {
        lastEventName = "unknown";
      }

      if (eventToImages[lastEventName] === undefined) {
        eventToImages[lastEventName] = [];
      } else {
        console.log(eventToImages[lastEventName]);
      }
      const linkObj = jQuery(tds[1]).find("a")[0];
      const image = {
        event: lastEventName,
        imageName: linkObj.innerText,
        url: linkObj.href,
        row: v as HTMLTableRowElement,
      };
      eventToImages[lastEventName].push(image);
    });

  // Asynchronously download each image and set the blob property of the image object.
  // This is done in parallel to speed up the process.
  const downloadPromises = Object.values(eventToImages).flatMap((imageList) =>
    imageList.map((image) => {
      setRowStatusDownloading(image.row);
      return downloadImage(image)
        .then(() => {
          // console.log(`Downloaded ${image.imageName}`);
          setRowStatusSuccess(image.row);
          return image;
        })
        .catch((error) => {
          console.error(`Error downloading ${image.imageName}:`, error);
          setRowStatusError(image.row);
          return image; // Return the image object even if the download fails
        });
    })
  );

  // Wait for all downloads to finish, but allow for some errors.
  await Promise.allSettled(downloadPromises).then((results) => {
    results.forEach((result) => {
      if (result.status === "rejected") {
        console.error("Download failed:", result.reason);
      } else {
        // console.log("Download succeeded:", result.value);
      }
    });
  });

  const zip = new JSZip();
  for (const [eventDateAndName, imageList] of Object.entries(eventToImages)) {
    const eventFolder = zip.folder(eventDateAndName);
    if (!eventFolder) {
      throw "Couldn't create event folder";
    }
    // console.log(imageList);
    const imageNames = new Set<string>();
    for (const image of imageList) {
      if (!image.blob) continue;
      const originalImageName = image.imageName;
      var uniqueImageName = image.imageName;
      var uniqueSuffix = 1;
      while (imageNames.has(uniqueImageName)) {
        uniqueImageName = `${originalImageName}-${uniqueSuffix}`;
        uniqueSuffix += 1;
      }
      imageNames.add(uniqueImageName);
      const fileExt = mime.default.getExtension(image.blob.type) ?? "";
      eventFolder.file(`${uniqueImageName}.${fileExt}`, image.blob);
      // console.log(`Response type: ${image.blob.type}`);
      // console.log(`text: ${uniqueImageName}, url: ${image.url}`);
    }
  }
  console.debug("Generating zip...");
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  });
  const zipName = `${caseNo}${protectedPersonName ? ` - ${protectedPersonName}` : ""}.zip`;
  saveAs(blob, zipName);
  setOverallStatusSuccess();
}

main();
