"use client"
import{ useEffect, useState } from 'react'

const UseWindow = () => {
    const [mounted, setIsMounted] = useState(false)
    const windowObj = typeof window !== "undefined" ? window : null
    
    useEffect(() => {
        setIsMounted(true)
    }, [])

    if (!mounted) {
        return null;
    }

    return windowObj
}

export default UseWindow