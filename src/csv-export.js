import { createObjectCsvWriter } from "csv-writer"
import path from "path"
import fs from "fs/promises"

export async function exportToCSV(contacts, filename = "contacts.csv") {
  // Ensure output directory exists
  const outputDir = path.join(process.cwd(), "output")
  await fs.mkdir(outputDir, { recursive: true })

  const filePath = path.join(outputDir, filename)

  // CSV headers matching the required format
  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: "companyName", title: "Company Name" },
      { id: "companyPhone", title: "Company Phone Number" },
      { id: "companyType", title: "Company Type" },
      { id: "companyDomain", title: "Company Domain" },
      { id: "contactFirstName", title: "Contact First Name" },
      { id: "contactLastName", title: "Contact Last Name" },
      { id: "contactJobTitle", title: "Contact Job Title" },
      { id: "contactEmail", title: "Contact Email Address" },
      { id: "contactPhone", title: "Contact Phone Number" },
      { id: "owner", title: "Owner" },
      { id: "companyState", title: "Company State" },
    ],
  })

  // Transform contacts to CSV format
  const csvRecords = contacts.map((contact) => ({
    companyName: contact.schoolName || "",
    companyPhone: contact.schoolPhone || "",
    companyType: "School",
    companyDomain: contact.schoolDomain || "",
    contactFirstName: contact.firstName || "",
    contactLastName: contact.lastName || "",
    contactJobTitle: contact.jobTitle || "",
    contactEmail: contact.email || "",
    contactPhone: contact.phone || "",
    owner: "Partnerships",
    companyState: contact.schoolState || "",
  }))

  await csvWriter.writeRecords(csvRecords)
  console.log(`[CSV] Exported ${csvRecords.length} contacts to ${filePath}`)

  return filePath
}
