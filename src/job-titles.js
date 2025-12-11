
export const APPROVED_JOB_TITLES = [
    "Academic Center Director",
    "Academic Counselor",
    "Academic Dean",
    "Academic Support Specialist",
    "Associate Head of Schools",
    "Co-Dean of Students",
    "Counseling Department Chair",
    "Dean of Student Life",
    "Dean of Students",
    "Director",
    "Director of Academic Operations",
    "Director of Academic Programs",
    "Director of Academic Services",
    "Director of Academic Success",
    "Director of Academic Support",
    "Director of Counseling",
    "Director of Curriculum",
    "Director of Leadership",
    "Director of Learning",
    "Director of Student Services",
    "Director of Student Support Services",
    "Director of Teaching and Learning",
    "Director of Wellness",
    "Director of Wellness & Leadership",
    "Division Head, Grades 11-12",
    "Division Head, Grades 9-12",
    "Elementary Principal",
    "Elementary School Dean",
    "Elementary School Director",
    "Elementary School Principal",
    "Executive Principal",
    "Grades 8-12 Director",
    "Head Counselor",
    "Head of Campus",
    "Head of Lower School",
    "Head of Middle School",
    "Head of School",
    "Head of School, Lower",
    "Head of School, Upper",
    "Head of Upper School",
    "Headmaster",
    "High School Dean",
    "High School Director",
    "High School Principal",
    "Lead Counselor",
    "Learning Resources Specialist",
    "Learning Specialist",
    "Learning Support Department Chair",
    "Learning Support Specialist",
    "Lower School Counselor",
    "Lower School Director",
    "Lower School Principal",
    "Middle & Upper School Counselor",
    "Middle School Dean",
    "Middle School Director",
    "Middle School Principal",
    "President",
    "Principal",
    "Sophomore Class Dean",
    "Student Services Coordinator",
    "Student Services Lead",
    "Superintendent",
    "Upper School Counselor",
    "Upper School Director",
    "Upper School Learning Specialist",
    "Upper School Principal",
    "Vice Principal Student Services",
]
  
  // Function to check if a job title matches (case-insensitive, partial match)
export function isApprovedJobTitle(title) {
    if (!title) return false
  
    const normalizedTitle = title.toLowerCase().trim()
  
    return APPROVED_JOB_TITLES.some((approved) => {
      const normalizedApproved = approved.toLowerCase()
      // Exact match or close match
      return (
        normalizedTitle === normalizedApproved ||
        normalizedTitle.includes(normalizedApproved) ||
        normalizedApproved.includes(normalizedTitle)
      )
    })
}
  
  // Get the standardized job title if it matches
export function getStandardizedTitle(title) {
    if (!title) return null
  
    const normalizedTitle = title.toLowerCase().trim()
  
    for (const approved of APPROVED_JOB_TITLES) {
      const normalizedApproved = approved.toLowerCase()
      if (
        normalizedTitle === normalizedApproved ||
        normalizedTitle.includes(normalizedApproved) ||
        normalizedApproved.includes(normalizedTitle)
      ) {
        return approved // Return the standardized version
      }
    }
  
    return null
}
